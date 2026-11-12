## 背景
`docs/design/TEMPLATE/README.md` §2 の Frontmatter 例が、`TEMPLATE_基本設計書.md` の実際の Frontmatter と一致していない。

- `related_documents`: README 例は DD と DS の2件のみ。テンプレート本体は6件（ガバナンス、DD、DS、IF、ENV、PM）。
- `purpose`: README 例は `[この文書の目的]`。テンプレート本体は具体的な文が入っている。

## 対応方針
- README の例が「BD テンプレートの抜粋」であることを明記する、またはテンプレート本体と同一内容に揃える。
- 二重管理を避けるため、例は最小限にし、正本は `TEMPLATE_基本設計書.md` と明記する案を優先する。

## 受け入れ条件
- [ ] README の Frontmatter 例とテンプレート本体の差異が解消されている、または差異の理由が明記されている。
- [ ] `git diff --check` が通る（UTF-8 BOMなし / LF）。
- [ ] Mermaid 検証 CI が通る。

## 対象
- `docs/design/TEMPLATE/README.md`
