## 背景
`docs/design/TEMPLATE/README.md` §6② で、設計書(BD/DD/DS/IF)への具象ソースコードの貼付は禁止されている。
しかし次の点が不足している。

- 自動検査が無く、レビューと作成完了チェックの目視に頼っている。
- 手順書(`docs/setup/`、`docs/how-to/`)ではコマンド例を載せており、設計書との扱いの差が文書化されていない。

## 対応方針
1. `validate_docs.py` に、設計書(`document_type` が `basic_design` / `detailed_design` / `data_structure_specification` / `interface_specification`)の本文で、`mermaid` 以外のコードフェンスを警告する検査を追加する。
2. `docs/design/TEMPLATE/README.md` §6② に「設計書では禁止、手順書ではコマンド例を許可」と明記する。
3. `docs/setup/doc_validation.md` の検査項目に追記する。

## 受け入れ条件
- [ ] 設計書内の非 mermaid コードフェンスが警告される(行番号つき)。
- [ ] 手順書・TEMPLATE 以外の文書、および mermaid フェンスは警告されない。
- [ ] 現行 docs に対してエラー0件(警告のみ)。
- [ ] README と検証文書が実装と一致している。

## 備考
- 警告のみとし、CI は失敗させない(例外の基準が固まるまで)。
