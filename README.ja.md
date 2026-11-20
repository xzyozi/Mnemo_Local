# Mnemo Local

[English](README.md)

ブラウザ内だけで動く、個人向けのセマンティックメモリです。Markdownメモ、ブラウザ履歴、ブックマークを検索し、興味関心の時間的な変化をグラフで表示します。

> このファイルは、英語版 [`README.md`](README.md) の日本語訳です。内容を変更する場合は、英語版を先に更新してください。

## 現在の状態

Phase 1〜3 を実装済みです。ただし、大きな制約が1つあります。

- **Embeddingは決定的なモックです。** `DeterministicEmbeddingProvider` は、文字列のハッシュからベクトルを作ります。表記が似た文字列は近くなりますが、意味が近い文書は近くなりません。そのため、意味検索、トピッククラスタリング、トピック名は、まだ意味のある結果になりません。実モデルへの置き換えは [#17](https://github.com/xzyozi/Mnemo_Local/issues/17) で管理しています。

## 機能

- **入力**（利用者が自分で選んだファイルだけを読みます。自動取得はしません）
  - Markdownフォルダ（File System Access API）、またはMarkdownファイル単体
  - ブラウザ履歴のエクスポート（JSON）
  - ブックマークのエクスポート（JSONまたはHTML）
- **検索**: 日本語に対応したキーワード検索（3-gram・2-gram）と、ベクトル検索を、Reciprocal Rank Fusion（RRF）で統合
- **永続化**: IndexedDB（スキーマv2）。内容が変わらなければEmbeddingを再利用
- **興味変遷グラフ**: トピッククラスタリングと、月別の積み上げ棒SVGグラフ。トピックをクリックすると検索結果を絞り込み
- **コンテンツとイベントの分離**: URLごとに1件だけ保存し、訪問は1回ごとにイベントとして保存

履歴とブックマークで検索対象になるのは、タイトルと、URLのホスト・パスだけです。ページ本文は取得しません。

## プライバシー

データを外部サーバーへ送信しません。すべての処理はブラウザ内で行います。

## 必要なもの

- Chromium系ブラウザ（フォルダ選択にFile System Access APIが必要です）
- Python 3.9以上（アプリをローカルで配信するため）
- `tools/mnemo_local.py` を使う場合: [GitHub CLI](https://cli.github.com/)（`gh`）。`gh auth login` でサインインしておきます

ES Modulesを使うため、`index.html` を `file://` で直接開いても動きません。

## クイックスタート

### 方法A: CIのビルドを取得して配信する

TypeScript CIは、ビルド結果を `mnemo-local-dist` アーティファクトとして公開します。この方法にNode.jsは不要です。

```powershell
python tools/mnemo_local.py main
```

指定したブランチで、直近に成功した `ci-typescript.yml` の実行からアーティファクトを取得し、`dist/` に配置します。その後、`http://127.0.0.1:4173/` でサーバーを起動し、ブラウザを開きます。

| オプション | 意味 |
| :--- | :--- |
| `-b NAME`、または位置引数のブランチ | アーティファクトを取得するブランチ（既定: 現在のブランチ） |
| `-p PORT` | サーバーのポート（既定: 4173、または `$MNEMO_PORT`） |
| `-f` | `dist/` が最新でも、再取得する |
| `--skip-sync` | 取得せず、既存の `dist/` を配信する |
| `--sync-only` | 取得だけを行い、サーバーは起動しない |
| `--no-open` | ブラウザを自動で開かない |

CIは、TypeScriptやビルド関連のファイルが変わったときだけ実行されます。成功した実行がないブランチでは、`main` を指定するか、先にブランチをpushしてください。

### 方法B: 自分でビルドする

Node.js 20以上が必要です。

```powershell
npm install
npm run build
python -m http.server 8000
```

その後、`http://localhost:8000/` を開きます。

## 開発

```powershell
npm run lint        # Biome
npm run typecheck   # tsc --noEmit
npm test            # Vitest
npm run build       # tsc。dist/ に出力
python -m pytest    # tools/ のテスト（uv sync --extra dev）
```

Node.jsが使えない端末では、ブランチをpushして、GitHub Actionsにこれらの検証を実行させてください。

| ワークフロー | 検証内容 |
| :--- | :--- |
| `ci-typescript.yml` | Biome、型検査、テスト、ビルド、`mnemo-local-dist` アーティファクト |
| `ci-python.yml` | `tools/` のRuff、Mypy、Pytest |
| `validate-docs.yml` | 文書のFrontmatter、リンク、文字コード、改行コード |
| `validate-mermaid.yml` | 文書内のMermaid図 |

`package-lock.json` はまだコミットしていないため、TypeScript CIは `npm install --ignore-scripts` で代替しています。

## リポジトリ構成

| パス | 内容 |
| :--- | :--- |
| `src/` | TypeScriptのソースとテスト |
| `index.html` | アプリのページ。`dist/index.js` を読み込む |
| `tools/` | ローカル起動ツール `mnemo_local.py` と、そのテスト |
| `docs/` | 要求、設計、ADR、手順書（日本語） |
| `templates/typescript/` | 新しいTypeScriptプロジェクトを始めるための雛形 |
| `CONTEXT.md` | プロジェクト用語集 |
| `.github/` | ワークフローと検証スクリプト |

## ドキュメント

文書は日本語で書かれています。まず、ガバナンスの [`docs/README.md`](docs/README.md) を読んでください。

| 文書 | 内容 |
| :--- | :--- |
| [`docs/features/local-semantic-memory.md`](docs/features/local-semantic-memory.md) | 要求・機能仕様 |
| [`docs/design/APP-BD-001_Local-Semantic-Memory.md`](docs/design/APP-BD-001_Local-Semantic-Memory.md) | 基本設計 |
| [`docs/design/APP-DD-001_Local-Semantic-Memory.md`](docs/design/APP-DD-001_Local-Semantic-Memory.md) | 詳細設計 |
| [`docs/design/APP-DS-001_Local-Semantic-Memory.md`](docs/design/APP-DS-001_Local-Semantic-Memory.md) | データ構造仕様 |
| [`docs/adr/`](docs/adr/) | アーキテクチャ決定記録 |
| [`docs/setup/typescript_setup.md`](docs/setup/typescript_setup.md) | TypeScript環境構築と手動確認 |
| [`docs/setup/git_flow_and_branch_policy.md`](docs/setup/git_flow_and_branch_policy.md) | ブランチ・コミット規約 |

## ライセンス

Apache License 2.0。[`LICENSE`](LICENSE) を参照してください。
