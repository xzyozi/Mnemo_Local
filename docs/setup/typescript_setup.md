---
title: "TypeScript プロジェクト環境構築手順書"
document_type: "environment_setup_procedure"
document_role: "procedure"
ssot_scope: "environment"
status: "draft"
version: "1.1"
created_at: "2026-11-04"
updated_at: "2026-11-20"
author: "xzyozi"
owner: "xzyozi"
purpose: "このリポジトリのTypeScript開発環境、検証手順、CI成果物を使った手動確認の手順を定義するため"
related_documents:
  - "ドキュメントガバナンス（相対パス: ../README.md）"
  - "Git Flow 運用規約（相対パス: ./git_flow_and_branch_policy.md）"
---

# TypeScript プロジェクト環境構築手順書

本ドキュメントは、このリポジトリのTypeScript開発環境、品質確認の手順、およびGitHub Actionsの成果物を使った手動確認の手順を定める。`templates/typescript/` の雛形を、別の新規プロジェクトへ展開する手順も、第6章に記載する。

---

## 1. 目的・対象範囲

- **目的**: 統一された品質ガードレール（Biome / TypeScript / Vitest）を持つ開発環境の維持と、ビルド成果物の手動確認。
- **対象環境**: ローカル開発環境（macOS / Linux / Windows）および GitHub Actions 実行環境。
- **対象者**: プロジェクト開発者、保守担当者。
- **対象外**: Node.js 自体のインストール手順（Node.js 20 LTS 以上の利用を前提とする）。

---

## 2. 前提条件

| 用途                 | 必要なもの                                                     |
| :------------------- | :------------------------------------------------------------- |
| ビルド・Lint・テスト | Node.js 20.x 以上、npm 10.x 以上                               |
| ローカル配信         | Python 3.9 以上                                                |
| CI成果物の自動取得   | GitHub CLI（`gh`）。`gh auth login` でサインイン済みであること |
| 動作確認             | Chromium 系ブラウザ（File System Access API を使うため）       |

Node.js が使えない端末では、ビルド・Lint・テストをGitHub Actionsで実行する（第4章）。

---

## 3. ローカルでの品質確認

このリポジトリは、雛形の内容をルートへ展開済みである。第6章の展開手順は実行しない。

```bash
npm install
```

次の4コマンドが、すべて正常終了することを確認する。

| 確認項目          | 実行コマンド        | 期待結果                                               |
| :---------------- | :------------------ | :----------------------------------------------------- |
| **Lint / Format** | `npm run lint`      | 全ファイルで指摘ゼロで終了すること                     |
| **型検査**        | `npm run typecheck` | 型エラーなしで終了すること                             |
| **単体テスト**    | `npm test`          | すべてのテストが通過すること                           |
| **ビルド**        | `npm run build`     | `dist/` ディレクトリにコンパイル成果物が出力されること |

整形の指摘は、`npm run format`（`biome check --write .`）で自動修正できる。

---

## 4. CI（GitHub Actions）

`.github/workflows/ci-typescript.yml` が、`main` または `develop` 向けの push と pull request で実行される。TypeScript、`package.json`、`tsconfig.json`、`biome.json`、ワークフロー自体が変更されたときだけ起動する。

| 順序 | 内容                                                                            |
| :--- | :------------------------------------------------------------------------------ |
| 1    | Node.js 20 をセットアップする                                                   |
| 2    | 依存関係をインストールする（下記の lockfile の扱いを参照）                      |
| 3    | `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` を順に実行する |
| 4    | `dist/` を `mnemo-local-dist` という名前のArtifactとしてアップロードする        |

ルートに `package.json` がない場合、これらのステップはスキップされる。

### 4.1 lockfile の扱い

`package-lock.json` は、まだコミットしていない。そのため、現在のCIは次のように動作する。

| 状態                       | CIの動作                                                    |
| :------------------------- | :---------------------------------------------------------- |
| `package-lock.json` がある | `npm ci` を実行する                                         |
| `package-lock.json` がない | `npm install --ignore-scripts` を実行する（暫定の代替動作） |

lockfile がない間は、実行のたびに依存関係が解決し直されるため、ビルドの再現性は保証されない。Node.js が使える環境（Codespaces など）で `npm install` を実行し、生成された `package-lock.json` をコミットした後は、CIが自動的に `npm ci` へ切り替わる。

---

## 5. 手動確認（ブラウザでの動作確認）

アプリは `index.html` が `./dist/index.js` を ES Modules として読み込む。`file://` による直接起動は、ES Modules の読み込み制約により対象外とする。必ず HTTP 経由で配信する。

### 方法A: 起動ツールを使う（推奨。Node.js 不要）

```bash
python tools/mnemo_local.py main
```

指定したブランチで、直近に成功した `ci-typescript.yml` の実行から `mnemo-local-dist` を取得し、`dist/` に配置する。その後、`http://127.0.0.1:4173/` でサーバーを起動し、ブラウザを開く。

| オプション                | 意味                                                        |
| :------------------------ | :---------------------------------------------------------- |
| `-b NAME`、または位置引数 | 取得するブランチ（既定: 現在のブランチ）                    |
| `-p PORT`                 | サーバーのポート（既定: 4173、または環境変数 `MNEMO_PORT`） |
| `-f`                      | `dist/` が最新でも、再取得する                              |
| `--skip-sync`             | 取得せず、既存の `dist/` を配信する                         |
| `--sync-only`             | 取得だけを行い、サーバーは起動しない                        |
| `--no-open`               | ブラウザを自動で開かない                                    |

CIはTypeScript関連ファイルの変更時だけ実行される。成功した実行がないブランチを指定すると、取得に失敗する。その場合は `main` を指定するか、ブランチをpushしてCIを実行する。

### 方法B: Artifactを手動で取得する

1. GitHubの Actions 画面で、対象の `TypeScript CI` の実行を開く。
2. `mnemo-local-dist` をダウンロードして展開する。
3. リポジトリルートに `dist/` フォルダを作成し、展開した中身を入れる（`index.html` と同じ階層ではなく、`dist/` の中）。
4. リポジトリルートで次を実行する。

```bash
python -m http.server 8000
```

5. ブラウザで `http://localhost:8000/` を開く。

### 方法C: ローカルでビルドする（Node.js が必要）

```bash
npm install
npm run build
python -m http.server 8000
```

### 確認項目

- Markdownフォルダ、または履歴・ブックマークのエクスポートファイルを読み込める。
- キーワード検索ができる。
- 月次の興味変遷グラフが表示され、トピックのクリックで検索結果が絞り込まれる。

現在のEmbeddingは決定的なモックである。意味検索、トピック分類、トピック名は、実モデルへの置き換え（Issue #17）まで、意味的な精度を持たない。

---

## 6. 新規プロジェクトへの雛形の展開

別のリポジトリで、`templates/typescript/` の雛形を使って新規プロジェクトを始める場合の手順である。**このリポジトリでは実行しない。** ルートの `package.json`、`tsconfig.json`、`biome.json` を上書きしてしまう。

### 手順 1: 雛形の展開

```bash
cp -r templates/typescript/* .
```

### 手順 2: プロジェクト名の設定

`package.json` の `name` と `description` を、対象プロジェクトに合わせて更新する。

### 手順 3: 依存関係のインストール

```bash
npm install
```

実行後に生成される `package-lock.json` は、必ずGitの追跡対象にコミットする。

### 注意

ルートの設定（`tsconfig.json` など）は、ブラウザ向けに雛形から変更している（`module`、`moduleResolution`、`lib` など）。雛形は、Node.js 向けの出発点であり、このリポジトリの設定とは一致しない。
