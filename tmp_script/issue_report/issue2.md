## 背景
設計書テンプレートの品質確認は人手のチェックリストに依存しており、自動化されているのは Mermaid 検証のみ。
Frontmatter の不備、未置換プレースホルダ、リンク切れを機械的に検出できない。

## 提案
Python 標準ライブラリのみで動くテンプレート／ドキュメント検証スクリプトを追加し、`.github/ci.sh`（`ci.yml` が検出する契約）から呼び出す。

### 検査項目（初版）
1. Frontmatter 必須キーの存在（`docs/README.md` §6 準拠）
2. `document_type` と `ssot_scope` の許容値チェック
3. `status` / `document_role` の許容値、日付形式 `YYYY-MM-DD`、`updated_at >= created_at`
4. `related_documents` 内の相対パスの実在確認（`TEMPLATE/` 配下は仕様上プレースホルダ `./...` を許容）
5. `TEMPLATE/` 以外の文書での未置換 `[ ... ]` / `YYYY-MM-DD` の検出
6. 改行コード LF、BOMなしの確認

## 受け入れ条件
- [ ] スクリプトが追加され、現行 `docs/` に対して成功する。
- [ ] 意図的に壊した入力で失敗する（簡易テストまたは手動確認結果を記録）。
- [ ] `.github/ci.sh` から呼ばれ、PR の CI で実行される。
- [ ] 追加依存なし（標準ライブラリのみ）。
- [ ] 使い方を `docs/setup/` の既存文書または README に追記する。

## 備考
- `ci.yml` は `.github/ci.sh` が存在すれば実行する契約のため、ワークフロー本体の変更は不要。
