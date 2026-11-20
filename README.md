# Mnemo Local

[日本語](README.ja.md)

A personal semantic memory that runs entirely in your browser. It searches your Markdown notes, browser history, and bookmarks, and shows how your interests change over time.

## Status

Phases 1 to 3 are implemented. One important limitation remains.

- **Embeddings are a deterministic mock.** `DeterministicEmbeddingProvider` derives vectors from string hashes. Similar spellings score close together, but similar meanings do not. Semantic search, topic clustering, and topic names are therefore not yet meaningful. Replacing the mock with a real model is tracked in [#17](https://github.com/xzyozi/Mnemo_Local/issues/17).

## Features

- **Inputs** (files you select yourself; nothing is read automatically)
  - A Markdown folder (File System Access API) or single Markdown files
  - Browser history export (JSON)
  - Bookmark export (JSON or HTML)
- **Search**: Japanese-aware keyword search (3-gram and 2-gram) combined with vector search through Reciprocal Rank Fusion (RRF)
- **Persistence**: IndexedDB (schema v2). Embeddings are reused when content is unchanged
- **Interest timeline**: topic clustering and a monthly stacked-bar SVG graph. Click a topic to filter the search results
- **Content and events are separate**: each URL is stored once, and every visit is stored as its own event

For history and bookmarks, only the title plus the host and path of the URL are searched. Page content is not fetched.

## Privacy

Your data is never sent to an external server. All processing happens in the browser.

## Requirements

- A Chromium-based browser (the folder picker needs the File System Access API)
- Python 3.9 or later, to serve the app locally
- To use `tools/mnemo_local.py`: the [GitHub CLI](https://cli.github.com/) (`gh`), signed in with `gh auth login`

Opening `index.html` directly with `file://` does not work, because the app uses ES modules.

## Quick start

### Option A: download the CI build and serve it

The TypeScript CI publishes the build as the `mnemo-local-dist` artifact. This option needs no Node.js.

```powershell
python tools/mnemo_local.py main
```

The tool downloads the artifact from the latest successful `ci-typescript.yml` run on the given branch, places it in `dist/`, starts a server at `http://127.0.0.1:4173/`, and opens the browser.

| Option                            | Meaning                                                       |
| :-------------------------------- | :------------------------------------------------------------ |
| `-b NAME`, or a positional branch | Branch whose artifact is downloaded (default: current branch) |
| `-p PORT`                         | Server port (default: 4173, or `$MNEMO_PORT`)                 |
| `-f`                              | Download again even if `dist/` is current                     |
| `--skip-sync`                     | Serve the existing `dist/` without downloading                |
| `--sync-only`                     | Download only; do not start the server                        |
| `--no-open`                       | Do not open the browser                                       |

The CI only runs when TypeScript or build files change. If a branch has no successful run, specify `main` or push the branch first.

### Option B: build it yourself

This option needs Node.js 20 or later.

```powershell
npm install
npm run build
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Development

```powershell
npm run lint        # Biome
npm run typecheck   # tsc --noEmit
npm test            # Vitest
npm run build       # tsc, writes dist/
python -m pytest    # tools/ tests (uv sync --extra dev)
```

If Node.js is not available on your machine, push your branch and let GitHub Actions run these checks.

| Workflow               | What it checks                                                       |
| :--------------------- | :------------------------------------------------------------------- |
| `ci-typescript.yml`    | Biome, type check, tests, build, and the `mnemo-local-dist` artifact |
| `ci-python.yml`        | Ruff, Mypy, and Pytest for `tools/`                                  |
| `validate-docs.yml`    | Front matter, links, encoding, and line endings of the documents     |
| `validate-mermaid.yml` | Mermaid diagrams in the documents                                    |

`package-lock.json` is not committed yet, so the TypeScript CI falls back to `npm install --ignore-scripts`.

## Repository layout

| Path                    | Contents                                                         |
| :---------------------- | :--------------------------------------------------------------- |
| `src/`                  | TypeScript source and tests                                      |
| `index.html`            | The app page. It loads `dist/index.js`                           |
| `tools/`                | `mnemo_local.py`, the local launcher, and its tests              |
| `docs/`                 | Requirements, design, ADRs, and procedures (written in Japanese) |
| `templates/typescript/` | Scaffold for starting a new TypeScript project                   |
| `CONTEXT.md`            | Glossary of project terms (Japanese)                             |
| `.github/`              | Workflows and validation scripts                                 |

## Documentation

The documents are written in Japanese. Start with the governance guide: [`docs/README.md`](docs/README.md).

| Document                                                                                             | Contents                          |
| :--------------------------------------------------------------------------------------------------- | :-------------------------------- |
| [`docs/features/local-semantic-memory.md`](docs/features/local-semantic-memory.md)                   | Requirements                      |
| [`docs/design/APP-BD-001_Local-Semantic-Memory.md`](docs/design/APP-BD-001_Local-Semantic-Memory.md) | Basic design                      |
| [`docs/design/APP-DD-001_Local-Semantic-Memory.md`](docs/design/APP-DD-001_Local-Semantic-Memory.md) | Detailed design                   |
| [`docs/design/APP-DS-001_Local-Semantic-Memory.md`](docs/design/APP-DS-001_Local-Semantic-Memory.md) | Data structures                   |
| [`docs/adr/`](docs/adr/)                                                                             | Architecture decision records     |
| [`docs/setup/typescript_setup.md`](docs/setup/typescript_setup.md)                                   | TypeScript setup and manual check |
| [`docs/setup/git_flow_and_branch_policy.md`](docs/setup/git_flow_and_branch_policy.md)               | Branch and commit conventions     |

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
