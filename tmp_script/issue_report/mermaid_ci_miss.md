## 背景
Mermaid CI(`validate-mermaid.yml`)が、Mermaid図を含む文書の不具合を検出できなかった。
tray-translate 側の `TT-DD-001_詳細設計書.md`(Mermaid 3図を含む)で発生した。この文書は日本語ファイル名である。
原因の確定調査は別作業とし、本 Issue では事象と当たりの記録までを扱う。

## 事象
- PR/push 実行時のMermaid検証がエラーなしで通過し、図の不具合を取り逃した。
- 取り逃がした具体的な図の不具合内容は、調査時に特定する。

## 原因の当たり(未確定)

### 有力: 日本語ファイル名が検証対象から落ちる
`collectChangedMarkdownFiles` は `git diff --name-only` の出力を `endsWith(".md")` で絞っている。
Git の既定(`core.quotePath=true`)では、非ASCII文字を含むパスは8進エスケープ付きでダブルクォートされる。

```
"docs/design/TEMPLATE/TEMPLATE_\350\251\263\347\264\260\350\250\255\350\250\210\346\233\270.md"
```

末尾が `.md"` になるため `endsWith(".md")` が偽になり、対象から除外される。
全件が除外されると `No changed Markdown files under docs; Mermaid validation skipped.` を出して終了コード0で成功する。
本リポジトリで `git diff --name-only <empty-tree> HEAD -- docs/design/TEMPLATE` を実行し、日本語名の4件がクォートされることを確認済み。

`--all`(workflow_dispatch)は `readdirSync` を使うため、この影響を受けない。

### 副次的な当たり
- 検証がスキップされても成功扱いになる(出力は通常ログ1行のみ)。対象が0件の理由が見えない。
- mmdc のバージョンが 11.4.2 固定のため、GitHub 上の描画に使われる Mermaid のバージョンと差がある可能性がある。GitHub 側でのみ崩れる構文は検出できない。
- `<String>` のようなラベル内の山括弧は、sequenceDiagram で HTML タグとして解釈され、文字が消えても mmdc は成功する。構文エラーにならない描画崩れは検出できない。

## 対応案(調査後に確定)
- `git diff` に `-z` を付けて NUL 区切りで読む、または `-c core.quotePath=false` を指定する。
- 日本語名を含む `.md` が検証対象に入ることを確認する回帰テストを追加する。
- 対象0件のときの扱い(警告表示など)を見直す。

## 受け入れ条件
- [ ] 取り逃がした図の不具合を特定し、原因を確定する。
- [ ] 日本語ファイル名の `.md` が差分検証の対象に含まれる。
- [ ] 日本語ファイル名の文書内にある不正なMermaid図で、CIが失敗する。
- [ ] 修正内容を `docs/setup/mermaid_ci_validation.md` に反映する。
