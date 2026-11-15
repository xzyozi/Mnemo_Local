from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest import mock

import pytest
from mnemo_local import (
    DEFAULT_PORT,
    parse_args,
    read_meta,
    resolve_branch,
    sync_dist,
    write_meta,
)


def test_parse_args_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MNEMO_PORT", raising=False)
    args = parse_args([])
    assert args.branch_pos is None
    assert args.branch_opt is None
    assert args.port == DEFAULT_PORT
    assert args.force is False
    assert args.skip_sync is False
    assert args.sync_only is False
    assert args.no_open is False


def test_parse_args_options(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MNEMO_PORT", "9000")
    args = parse_args(
        ["feat/test", "-b", "main", "-p", "8080", "-f", "--skip-sync", "--sync-only", "--no-open"]
    )
    assert args.branch_pos == "feat/test"
    assert args.branch_opt == "main"
    assert args.port == 8080
    assert args.force is True
    assert args.skip_sync is True
    assert args.sync_only is True
    assert args.no_open is True


def test_meta_roundtrip(tmp_path: Path) -> None:
    meta_file = tmp_path / ".artifact-meta"
    assert read_meta(meta_file) == {}

    data = {"branch": "main", "run_id": "12345", "head_sha": "abcdef123456"}
    write_meta(meta_file, data)
    assert read_meta(meta_file) == data


def test_resolve_branch_explicit(tmp_path: Path) -> None:
    assert resolve_branch("feat/x", repo_root=tmp_path, env={}) == "feat/x"


def test_resolve_branch_from_git(tmp_path: Path) -> None:
    completed = subprocess.CompletedProcess(
        args=["git", "rev-parse", "--abbrev-ref", "HEAD"],
        returncode=0,
        stdout="main\n",
        stderr="",
    )
    with mock.patch("mnemo_local.run_cmd", return_value=completed):
        assert resolve_branch(None, repo_root=tmp_path, env={}) == "main"


def test_resolve_branch_detached_head_raises(tmp_path: Path) -> None:
    completed = subprocess.CompletedProcess(
        args=["git", "rev-parse", "--abbrev-ref", "HEAD"],
        returncode=0,
        stdout="HEAD\n",
        stderr="",
    )
    with mock.patch("mnemo_local.run_cmd", return_value=completed):
        with pytest.raises(RuntimeError, match="detached HEAD"):
            resolve_branch(None, repo_root=tmp_path, env={})


def test_sync_dist_skips_when_up_to_date(tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    dist_dir.mkdir()
    (dist_dir / "index.js").write_text("console.log('ok');\n", encoding="utf-8")
    write_meta(dist_dir / ".artifact-meta", {"branch": "main", "run_id": "42"})

    runs_payload = json.dumps(
        [
            {
                "databaseId": 42,
                "headSha": "1234567890abcdef",
                "headBranch": "main",
                "event": "push",
                "createdAt": "2026-11-15T00:00:00Z",
                "url": "https://example.com/runs/42",
            }
        ]
    )
    list_result = subprocess.CompletedProcess(
        args=["gh"], returncode=0, stdout=runs_payload, stderr=""
    )

    with (
        mock.patch("mnemo_local.shutil.which", return_value="/usr/bin/gh"),
        mock.patch("mnemo_local.run_cmd", return_value=list_result) as run_mock,
    ):
        sync_dist(
            repo_root=tmp_path,
            dist_dir=dist_dir,
            branch="main",
            force=False,
            env={"PATH": "/usr/bin"},
        )
        assert run_mock.call_count == 1


def test_sync_dist_downloads_and_updates_meta(tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    runs_payload = json.dumps(
        [
            {
                "databaseId": 99,
                "headSha": "abcdef1234567890",
                "headBranch": "feat/demo",
                "event": "push",
                "createdAt": "2026-11-15T01:00:00Z",
                "url": "https://example.com/runs/99",
            }
        ]
    )

    def fake_run_cmd(
        args: list[str], *, cwd: Path, env: dict[str, str], capture: bool = True
    ) -> subprocess.CompletedProcess[str]:
        if args[:3] == ["gh", "run", "list"]:
            return subprocess.CompletedProcess(args=args, returncode=0, stdout=runs_payload)
        if args[:3] == ["gh", "run", "download"]:
            target = Path(args[args.index("-D") + 1])
            target.mkdir(parents=True, exist_ok=True)
            (target / "index.js").write_text("export {};\n", encoding="utf-8")
            return subprocess.CompletedProcess(args=args, returncode=0, stdout="")
        raise AssertionError(f"Unexpected command: {args}")

    with (
        mock.patch("mnemo_local.shutil.which", return_value="/usr/bin/gh"),
        mock.patch("mnemo_local.run_cmd", side_effect=fake_run_cmd),
    ):
        sync_dist(
            repo_root=tmp_path,
            dist_dir=dist_dir,
            branch="feat/demo",
            force=False,
            env={"PATH": "/usr/bin"},
        )

    assert (dist_dir / "index.js").is_file()
    meta = read_meta(dist_dir / ".artifact-meta")
    assert meta["branch"] == "feat/demo"
    assert meta["run_id"] == "99"


def test_sync_dist_raises_when_no_runs(tmp_path: Path) -> None:
    empty_result = subprocess.CompletedProcess(args=["gh"], returncode=0, stdout="[]", stderr="")
    with (
        mock.patch("mnemo_local.shutil.which", return_value="/usr/bin/gh"),
        mock.patch("mnemo_local.run_cmd", return_value=empty_result),
    ):
        with pytest.raises(RuntimeError, match="No successful"):
            sync_dist(
                repo_root=tmp_path,
                dist_dir=tmp_path / "dist",
                branch="no-such-branch",
                force=False,
                env={"PATH": "/usr/bin"},
            )
