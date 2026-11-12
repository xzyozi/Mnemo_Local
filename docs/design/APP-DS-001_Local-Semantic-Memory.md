---
title: "Local Semantic Memory データ構造仕様書"
document_type: "data_structure_specification"
document_number: "APP-DS-001"
document_role: "normative"
ssot_scope: "persistent_data"
status: "draft"
version: "0.3"
created_at: "2026-11-12"
updated_at: "2026-11-12"
author: "xzyozi"
owner: "xzyozi"
purpose: "検索対象、チャンク、Embedding、インデックス、トピック集計をブラウザ内で保存するデータ構造と互換性方針を定義するため"
related_documents:
  - "ドキュメントガバナンス（相対パス: ../README.md）"
  - "Local Semantic Memory 基本設計書（相対パス: ./APP-BD-001_Local-Semantic-Memory.md）"
  - "Local Semantic Memory 要求仕様（相対パス: ../features/local-semantic-memory.md）"
---

# Local Semantic Memory データ構造仕様書（ドラフト）

## 1. データ管理方針

- **保存先**: Phase 1はメモリ上だけで扱い、リロード時に再構築する。Phase 2以降はブラウザのIndexedDBへ保存する。
- **文字コード**: 入力・表示ともUTF-8として扱う。
- **時刻**: Unix epoch millisecondsを基本値とし、表示時に利用者のローカル時刻へ変換する。
- **機密性**: 入力本文、URL、検索語、Embeddingを外部へ送信しない。IndexedDBの暗号化はブラウザ標準機能に依存しないため、端末共有時のプロファイル管理を利用者責任とする。
- **再構築**: スキーマ変更またはモデル変更時に、保存データを削除して再インデックスできる。

## 2. エンティティ構造

```mermaid
erDiagram
    SOURCE_DOCUMENT ||--o{ MEMORY_CHUNK : split_into
    MEMORY_CHUNK ||--o| EMBEDDING_CACHE : has
    MEMORY_CHUNK ||--o{ TOPIC_ASSIGNMENT : grouped_into
    TOPIC ||--o{ TOPIC_ASSIGNMENT : contains

    SOURCE_DOCUMENT {
        string source_id PK
        string source_type
        string source_locator
        string title
        string body
        number source_timestamp
        string source_timestamp_kind
        string source_hash
        string schema_version
    }
    MEMORY_CHUNK {
        string chunk_id PK
        string source_id FK
        number ordinal
        string body
        string content_hash
        number char_start
        number char_end
        string schema_version
    }
    EMBEDDING_CACHE {
        string chunk_id PK
        string model_id
        number dimensions
        number[] vector
        string generated_at
    }
    TOPIC {
        string topic_id PK
        string label
        string algorithm_version
        string created_at
    }
    TOPIC_ASSIGNMENT {
        string assignment_id PK
        string chunk_id FK
        string topic_id FK
        number score
    }
```

`SourceDocument`は入力元単位、`MemoryChunk`は検索・Embedding単位である。チャンク本文の同一性と、入力元・位置の同一性を分離することで、異なるファイルに同じ本文が存在しても衝突しない。

## 3. フィールド仕様

### 3.1 SourceDocument

| フィールド            | 型     | 必須  | 制約                                                                            |
| :-------------------- | :----- | :---: | :------------------------------------------------------------------------------ |
| `sourceId`            | string | 必須  | `markdown:`と正規化相対パスから生成する安定識別子。重複不可                     |
| `sourceType`          | enum   | 必須  | `markdown`、`history`、`bookmark`のいずれか                                     |
| `sourceLocator`       | string | 必須  | Markdownの相対パスまたは履歴・ブックマークのURL                                 |
| `title`               | string | 必須  | 空文字不可。表示用タイトル                                                      |
| `body`                | string | 必須  | 入力元の本文。Chunkerがこの本文を検索用チャンクへ分割する                       |
| `sourceTimestamp`     | number | 必須  | Unix epoch milliseconds。負数不可                                               |
| `sourceTimestampKind` | enum   | 必須  | `updated`（Markdown更新）、`visited`（履歴閲覧）、`created`（ブックマーク登録） |
| `sourceHash`          | string | 必須  | 入力元全体のSHA-256。再読込判定に使用                                           |
| `schemaVersion`       | string | 必須  | 保存スキーマのバージョン。初版は`1`                                             |

履歴は同一URLへの複数訪問を別の`SourceDocument`として保持できる。月次集計では`sourceTimestampKind=visited`を閲覧イベントとして扱い、Markdownの更新日時と混同しない。

### 3.2 MemoryChunk

| フィールド              | 型     | 必須  | 制約                                                  |
| :---------------------- | :----- | :---: | :---------------------------------------------------- |
| `chunkId`               | string | 必須  | `sourceId + ordinal`から生成する安定キー。重複不可    |
| `sourceId`              | string | 必須  | `SourceDocument.sourceId`への参照                     |
| `ordinal`               | number | 必須  | SourceDocument内の0始まりのチャンク順序               |
| `body`                  | string | 必須  | 検索対象のチャンク本文。空文字不可                    |
| `contentHash`           | string | 必須  | チャンク本文と検索用メタデータのSHA-256。差分判定専用 |
| `charStart` / `charEnd` | number | 必須  | 元本文における文字範囲。`charStart < charEnd`         |
| `schemaVersion`         | string | 必須  | 保存スキーマのバージョン                              |

### 3.3 EmbeddingCache

| フィールド    | 型       | 必須  | 制約                                      |
| :------------ | :------- | :---: | :---------------------------------------- |
| `chunkId`     | string   | 必須  | `MemoryChunk.chunkId`に対応               |
| `modelId`     | string   | 必須  | モデル名とバージョンを含む識別子          |
| `dimensions`  | number   | 必須  | ベクトル長と一致。候補モデルでは384を想定 |
| `vector`      | number[] | 必須  | `dimensions`と同じ長さ。有限値のみ        |
| `generatedAt` | string   | 必須  | ISO 8601形式                              |

multilingual-e5系を採用する場合、EmbeddingProviderが文書入力へ`passage: `、検索入力へ`query: `を付与する。呼び出し側は接頭辞を直接付与しない。

### 3.4 Topic / TopicAssignment

- `Topic.topicId`はクラスタリング実行ごとに安定性を保証しない。アルゴリズムまたは入力範囲が変わる場合は、`algorithmVersion`を更新する。
- `TopicAssignment.score`は所属度または距離から算出した評価値で、算出方法は後続の詳細設計書（DD）で定義する。
- 期間は`TopicAssignment`へ重複保存しない。月次期間は、対象Chunkが参照するSourceDocumentの`sourceTimestamp`と`sourceTimestampKind`から集計時に導出する。

## 4. IndexedDB構成（Phase 2以降）

- **データベース名**: `local-semantic-memory`
- **初期スキーマバージョン**: `1`
- **Object Store**:
  - `sourceDocuments`: keyPath `sourceId`。`sourceType`、`sourceTimestamp`、`sourceHash`にインデックスを作成する。
  - `chunks`: keyPath `chunkId`。`sourceId`、`contentHash`にインデックスを作成する。
  - `embeddings`: keyPath `chunkId`。`modelId`にインデックスを作成する。
  - `topics`: keyPath `topicId`。
  - `assignments`: keyPath `assignmentId`。`chunkId`、`topicId`にインデックスを作成する。
- **トランザクション**: SourceDocument・Chunk・Embeddingの更新は、対象入力単位で同一トランザクションとして扱う。
- **失敗時**: トランザクション失敗時は更新前の状態を維持し、再試行または対象データだけの再構築を選択できるようにする。
- **ベクトル検索上限**: ベクトル検索対象が50,000チャンクを超える場合は、期間・ソース・検索条件で絞り込んでからEmbeddingを読み込む。

## 5. 差分更新と互換性

1. 入力元を正規化し、`sourceHash`を算出する。
2. 同じ`sourceId`と`sourceHash`の保存済みSourceDocumentは再分割しない。
3. 本文またはチャンク境界が変わった場合は、Chunkの`contentHash`を再計算する。
4. 同じ`chunkId`と`contentHash`のChunkはEmbeddingを再利用できる。
5. `modelId`が変わった場合は、現行モデルでEmbeddingを再生成する。
6. `schemaVersion`が変わる場合は、新しいObject Storeまたは明示的な移行処理を使用する。暗黙のフィールド解釈変更は禁止する。

## 6. 削除とプライバシー

- 利用者は全データ削除を実行できる。
- SourceDocument削除時は対応するChunk、Embedding、TopicAssignmentも削除する。
- 入力元ファイルの削除や移動は自動追跡しない。次回同期時に利用者が再インデックスを実行する。
- ログには本文、URL、検索語、Embeddingを出力しない。
