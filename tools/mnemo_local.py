#!/usr/bin/env python3
"""Sync dist/ from GitHub Actions for a target branch and serve Mnemo Local."""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import webbrowser
from pathlib import Path

WORKFLOW_FILE = "ci-typescript.yml"
ARTIFACT_NAME = "mnemo-local-dist"
DEFAULT_PORT = 4173


def build_env() -> dict[str, str]:
    env = os.environ.copy()
    extra_paths = [
        str(Path.home() / ".local" / "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]
    current_path = env.get("PATH", "")
    parts = [p for p in extra_paths if p not in current_path.split(":")]
    if current_path:
        parts.append(current_path)
    env["PATH"] = ":".join(parts)
    return env


def run_cmd(
    args: list[str], *, cwd: Path, env: dict[str, str], capture: bool = True
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd),
        env=env,
        text=True,
        capture_output=capture,
        check=True,
    )


def resolve_branch(explicit_branch: str | None, *, repo_root: Path, env: dict[str, str]) -> str:
    if explicit_branch:
        return explicit_branch
    result = run_cmd(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=repo_root,
        env=env,
    )
    branch = result.stdout.strip()
    if branch == "HEAD" or not branch:
        raise RuntimeError("detached HEAD detected. Please specify a branch with --branch.")
    return branch


def read_meta(meta_file: Path) -> dict[str, str]:
    if not meta_file.is_file():
        return {}
    meta: dict[str, str] = {}
    for line in meta_file.read_text(encoding="utf-8").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            meta[k.strip()] = v.strip()
    return meta


def write_meta(meta_file: Path, data: dict[str, str]) -> None:
    lines = [f"{k}={v}" for k, v in data.items()]
    meta_file.write_text("\n".join(lines) + "\n", encoding="utf-8")


def sync_dist(
    *,
    repo_root: Path,
    dist_dir: Path,
    branch: str,
    force: bool,
    env: dict[str, str],
) -> None:
    if not shutil.which("gh", path=env.get("PATH")):
        raise RuntimeError("'gh' CLI not found. Install GitHub CLI or pass --skip-sync.")

    result = run_cmd(
        [
            "gh",
            "run",
            "list",
            "--workflow",
            WORKFLOW_FILE,
            "--branch",
            branch,
            "--status",
            "success",
            "--limit",
            "1",
            "--json",
            "databaseId,headSha,headBranch,event,createdAt,url",
        ],
        cwd=repo_root,
        env=env,
    )
    runs = json.loads(result.stdout or "[]")
    if not runs:
        raise RuntimeError(
            f"No successful '{WORKFLOW_FILE}' run found for branch '{branch}'.\n"
            "Hint: Push the branch so CI runs, specify another branch (e.g. 'main'), "
            "or use --skip-sync."
        )

    run_info = runs[0]
    run_id = str(run_info["databaseId"])
    head_sha = str(run_info["headSha"])
    created_at = str(run_info["createdAt"])
    run_url = str(run_info["url"])

    meta_file = dist_dir / ".artifact-meta"
    current_meta = read_meta(meta_file)
    if (
        not force
        and current_meta.get("branch") == branch
        and current_meta.get("run_id") == run_id
        and (dist_dir / "index.js").is_file()
    ):
        print(f"[mnemo-local] dist/ is already up to date (run={run_id}, sha={head_sha[:7]}).")
        return

    with tempfile.TemporaryDirectory(prefix="mnemo-dist-") as tmp:
        tmp_dist = Path(tmp) / "dist"
        print(f"[mnemo-local] Downloading '{ARTIFACT_NAME}' from run {run_id} ({head_sha[:7]})...")
        run_cmd(
            ["gh", "run", "download", run_id, "-n", ARTIFACT_NAME, "-D", str(tmp_dist)],
            cwd=repo_root,
            env=env,
            capture=False,
        )
        if not (tmp_dist / "index.js").is_file():
            raise RuntimeError("Downloaded artifact does not contain index.js")

        if dist_dir.exists():
            shutil.rmtree(dist_dir)
        shutil.move(str(tmp_dist), str(dist_dir))

    write_meta(
        meta_file,
        {
            "branch": branch,
            "run_id": run_id,
            "head_sha": head_sha,
            "created_at": created_at,
            "url": run_url,
        },
    )
    print(f"[mnemo-local] Updated dist/ from {run_url}")


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def serve(repo_root: Path, port: int, open_browser: bool) -> None:
    url = f"http://127.0.0.1:{port}/"
    print(f"[mnemo-local] Starting local server at {url} (Ctrl+C to stop)")

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(repo_root))
    with ReusableTCPServer(("127.0.0.1", port), handler) as httpd:
        if open_browser:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[mnemo-local] Stopped.")


def parse_args(argv: list[str]) -> argparse.Namespace:
    default_port = int(os.environ.get("MNEMO_PORT", DEFAULT_PORT))
    parser = argparse.ArgumentParser(
        prog="python3 tools/mnemo_local.py",
        description=(
            "Sync dist/ from the latest successful GitHub Actions artifact "
            f"({WORKFLOW_FILE}) for the target branch, then start a local HTTP server."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 tools/mnemo_local.py\n"
            "  python3 tools/mnemo_local.py feat/issue-14-event-maintenance\n"
            "  python3 tools/mnemo_local.py -b main -p 8000\n"
            "  python3 tools/mnemo_local.py --skip-sync\n"
            "  python3 tools/mnemo_local.py --sync-only"
        ),
    )
    parser.add_argument(
        "branch_pos",
        nargs="?",
        metavar="branch",
        help="Target git branch for GitHub Actions artifact (default: current branch)",
    )
    parser.add_argument(
        "-b",
        "--branch",
        dest="branch_opt",
        metavar="NAME",
        help="Target git branch (overrides positional branch)",
    )
    parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=default_port,
        help=f"Local HTTP server port (default: {default_port} or $MNEMO_PORT)",
    )
    parser.add_argument(
        "-f",
        "--force",
        action="store_true",
        help="Re-download artifact even if dist/ already matches the latest run",
    )
    parser.add_argument(
        "--skip-sync",
        action="store_true",
        help="Skip GitHub Actions sync and serve existing dist/",
    )
    parser.add_argument(
        "--sync-only",
        action="store_true",
        help="Sync dist/ only without starting the HTTP server",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="Do not open the browser automatically",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    repo_root = Path(__file__).resolve().parent.parent
    dist_dir = repo_root / "dist"
    env = build_env()

    try:
        branch = resolve_branch(args.branch_opt or args.branch_pos, repo_root=repo_root, env=env)
        print(f"[mnemo-local] Branch: {branch}")

        if args.skip_sync:
            print("[mnemo-local] Skipping GitHub Actions sync (--skip-sync).")
        else:
            sync_dist(
                repo_root=repo_root,
                dist_dir=dist_dir,
                branch=branch,
                force=args.force,
                env=env,
            )

        if not (dist_dir / "index.js").is_file():
            raise RuntimeError(
                f"{dist_dir / 'index.js'} not found. Run without --skip-sync to download it."
            )

        if args.sync_only:
            print("[mnemo-local] Sync completed (--sync-only).")
            return 0

        serve(repo_root=repo_root, port=args.port, open_browser=not args.no_open)
        return 0
    except subprocess.CalledProcessError as exc:
        msg = exc.stderr.strip() if exc.stderr else str(exc)
        print(f"Error: {msg}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
