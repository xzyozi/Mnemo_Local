## 概要

- Mermaid CIの差分検証で、日本語など非ASCIIのファイル名を持つMarkdownが検証対象から外れる問題を修正します。
- 対象外になった場合も、CIは「No changed Markdown files…skipped」を出して成功していました。そのため図の不具合を取り逃がします。

## 変更内容

- `.github/scripts/validateMermaidMarkdown.mjs` の `collectChangedMarkdownFiles` で、`git diff` に `-c core.quotePath=false` と `-z` を付けました。
- 出力を改行ではなくNUL区切りで分割します(2行の変更)。
- 原因: Gitの既定(`core.quotePath=true`)では、非ASCIIのパスが `"...\350\251..."` の形でダブルクォートされます。末尾が `.md"` になるため、`endsWith(".md")` の判定で除外されていました。

## 変更しないもの

- `--all`(手動実行)の経路は、`readdirSync` を使うため影響を受けず、変更していません。
- ワークフローのYAML、mermaid-cliのバージョン(11.4.2)、`docs/` 配下の文書は変更していません。

## 検証

- 実施済み: ベースとの差分がこの1ファイルの2行だけであることを `git diff` で確認しました。
- 未実施: このPRの作成環境に `node` がなく、スクリプトを実行していません。
- マージ前の確認: 日本語ファイル名のMarkdownを含む変更で、CIが「skipped」ではなく `Validated N Mermaid diagram(s)` を出すことを確認してください。

## 補足

- xzyozi/DEFAULT_PROJECT#34(コミット 31eca01)と同じ修正を、同じスクリプトを持つリポジトリへ展開するPRです。
- 改行コードは各リポジトリの既存ファイルに合わせています(LFまたはCRLF)。
