# Mnemo Local

ブラウザ内で完結する、個人向けセマンティック検索・興味変遷グラフの設計テンプレートです。

## 方針

- 主な記述・実装スタックは TypeScript とする。
- Markdownメモ、履歴、ブックマークをローカルで扱う。
- 外部サーバーへのデータ送信を前提にしない。
- GitHub Actionsの汎用TypeScript CIで、依存関係・Lint・型検査・テスト・ビルドを検証する。

## 構成

- `templates/typescript/`: TypeScriptプロジェクトの雛形
- `docs/features/`: 要求・機能仕様
- `docs/design/`: 基本設計、詳細設計、データ構造仕様の正本
- `docs/setup/`: TypeScript環境構築などの手順
- `docs/adr/`: アーキテクチャ判断の記録
- `CONTEXT.md`: プロジェクト用語集

## ローカル検証

TypeScriptプロジェクトでは、次のコマンドを必要に応じて実行します。

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

詳細な文書分類とSSOTの規約は [`docs/README.md`](docs/README.md) を参照してください。
