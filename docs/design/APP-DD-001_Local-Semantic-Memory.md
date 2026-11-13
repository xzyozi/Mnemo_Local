---
title: "Local Semantic Memory 詳細設計書"
document_type: "detailed_design"
document_number: "APP-DD-001"
document_role: "normative"
ssot_scope: "module_behavior"
status: "draft"
version: "0.6"
created_at: "2026-11-12"
updated_at: "2026-11-13"
author: "xzyozi"
owner: "xzyozi"
purpose: "Local Semantic Memoryの入力処理、チャンク化、Embedding、IndexedDB永続化、イベント蓄積、ハイブリッド検索、トピッククラスタリング、興味変遷グラフ可視化のモジュール契約を定義するため"
related_documents:
  - "ドキュメントガバナンス（相対パス: ../README.md）"
  - "Local Semantic Memory 基本設計書（相対パス: ./APP-BD-001_Local-Semantic-Memory.md）"
  - "Local Semantic Memory データ構造仕様書（相対パス: ./APP-DS-001_Local-Semantic-Memory.md）"
  - "Local Semantic Memory 要求仕様（相対パス: ../features/local-semantic-memory.md）"
  - "ADR-002 コンテンツとイベントの分離（相対パス: ../adr/002-content-event-separation.md）"
---

# Local Semantic Memory 詳細設計書（ドラフト）

## 1. 対象範囲

本書は、Markdown・履歴・ブックマーク入力の正規化、検索用チャンク生成、Embedding生成、IndexedDBへの差分保存、キーワード順位とベクトル順位を統合するReciprocal Rank Fusion（RRF）ハイブリッド検索、およびEmbeddingに基づくトピッククラスタリング・命名と月次興味変遷グラフの描画モジュール契約を正本とする。

### 1.1 対象機能

- Markdownフォルダの読み込み（フォルダ内の`.md`ファイル）
- 履歴・ブックマークエクスポートファイル（JSON / HTML）および単一Markdownファイルの読み込み
- 相対パス検証および履歴・ブックマークのURLスキーム除外
- 見出し・文字数単位のチャンク分割とSHA-256ハッシュ算出
- `passage: ` / `query: `接頭辞を付与するEmbedding生成
- IndexedDBおよびインメモリストアによる`SourceDocument`・`MemoryChunk`・`EmbeddingCache`の差分保存と再利用
- 履歴・ブックマークURLの正規化と、訪問・登録・更新の`SourceEvent`としての追記保存
- v1→v2のIndexedDB移行（履歴由来データの破棄と`events`ストアの追加）
- 日本語3-gram・2-gram全文検索とコサイン類似度ベクトル検索のRRFハイブリッド検索
- チャンクEmbeddingに基づくブラウザ内トピッククラスタリング（Phase 3）
- クラスタ代表語・頻出語からの自動トピック命名（Phase 3）
- `SourceEvent`の`timestamp`に基づく月次興味変遷集計（Phase 3）
- 外部依存なしのSVGによるインタラクティブな興味変遷グラフ描画（Phase 3）
- 入力、正規化、Embedding、永続化、検索、トピック解析で発生するエラーの分類と状態保全

### 1.2 対象外

- 外部サーバーとのデータ同期・利用者認証
- サーバー側での重いGPU推論

## 2. モジュールInterface

### 2.0 データ型

| 型名                  | 主なフィールド・定義                                                                                                                |
| :-------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `SourceType`          | `"markdown"` / `"history"` / `"bookmark"`                                                                                           |
| `RawFile`             | `path`, `title`, `body`, `updatedAt`, `sourceType?`, `sourceTimestampKind?`                                                         |
| `SourceDocument`      | `sourceId`, `sourceType`, `sourceLocator`, `title`, `body`, `sourceTimestamp`, `sourceTimestampKind`, `sourceHash`, `schemaVersion` |
| `EventType`           | `"updated"` / `"visited"` / `"created"`                                                                                             |
| `SourceEvent`         | `sourceId`, `eventType`, `timestamp`, `originalLocator?`                                                                            |
| `MemoryChunk`         | `chunkId`, `sourceId`, `ordinal`, `body`, `contentHash`, `charStart`, `charEnd`, `schemaVersion`                                    |
| `EmbeddingCache`      | `chunkId`, `modelId`, `dimensions`, `vector`, `generatedAt`                                                                         |
| `SearchEntry`         | `chunk`, `source`, `embedding?`                                                                                                     |
| `Topic`               | `topicId`, `label`, `algorithmVersion`, `createdAt`                                                                                 |
| `TopicAssignment`     | `assignmentId`, `chunkId`, `topicId`, `score`                                                                                       |
| `MonthlyTopicCount`   | `month`, `counts`, `total`                                                                                                          |
| `TopicAnalysisResult` | `topics`, `assignments`, `timeline`                                                                                                 |
| `StoredSnapshot`      | `documents`, `chunks`, `embeddings`, `events`                                                                                       |
| `SearchOptions`       | `sourceIds?`, `sourceTypes?`, `updatedAfter?`, `updatedBefore?`, `queryVector?`, `rrfK?`, `topicId?`                                |
| `Result<T, E>`        | `{ ok: true, value: T }` または `{ ok: false, error: E }`                                                                           |
| `NormalizeError`      | `"PATH_INVALID"` / `"URL_EXCLUDED"` / `"DOCUMENT_EMPTY"`                                                                            |
| `EmbeddingError`      | `"EMBEDDING_EMPTY"` / `"EMBEDDING_INVALID_VECTOR"` / `"EMBEDDING_FAILED"`                                                           |
| `StoreError`          | `"STORE_READ_FAILED"` / `"STORE_WRITE_FAILED"` / `"STORE_CLEAR_FAILED"`                                                             |
| `IndexError`          | `"INDEX_SIZE_LIMIT"` / `"INDEX_BUILD_FAILED"`                                                                                       |
| `SearchError`         | `"QUERY_EMPTY"` / `"SEARCH_FAILED"`                                                                                                 |
| `TopicError`          | `"TOPIC_INSUFFICIENT_DATA"` / `"TOPIC_ANALYSIS_FAILED"`                                                                             |

### 2.1 InputReader

**責務**: 利用者が選択またはドロップした入力を読み取り、ファイル・レコード単位の未加工データを返す。

- `readMarkdownDirectory(directory: FileSystemDirectoryHandle): Promise<InputReadResult>`
- `parseStructuredExport(fileName: string, content: string, fallbackUpdatedAt?: number): Result<RawFile[], FileReadError>`
- `readInputFiles(files: Iterable<File>): Promise<RawFileBatch>`

### 2.2 Normalizer

**責務**: RawFileを検証し、SourceDocumentとSourceEventを生成する。

- `normalize(raw: RawFile, hasher: Hasher): Promise<Result<SourceDocument, NormalizeError>>`
- `normalizeUrl(urlText: string): string`

**契約**:

- 履歴・ブックマークの`sourceId`は、`history:`または`bookmark:`と、正規化後のURLから生成する。訪問時刻は`sourceId`に含めない。
- 履歴・ブックマークの`body`は「タイトル + URLのホストとパス」から組み立てる。クエリ文字列は含めない。`SourceDocument.sourceTimestamp`には、そのレコードの`raw.updatedAt`を設定する（既存ドキュメントとの統合は2.5で扱う）。
- Markdownの`sourceId`は`markdown:`と正規化相対パスから生成する。移動・リネームは別の`sourceId`として扱う。

**URL正規化規則（`normalizeUrl`）**:

| 項目                                   | 扱い         |
| :------------------------------------- | :----------- |
| `#fragment`                            | 除去する     |
| クエリのうち`utm_*`、`fbclid`、`gclid` | 除去する     |
| 上記以外のクエリ                       | 維持する     |
| ホスト名                               | 小文字にする |
| 末尾の`/`                              | 維持する     |
| `www.`の有無                           | 維持する     |

### 2.3 Chunker

**責務**: SourceDocumentの本文を検索単位へ分割する。

- `chunk(source: SourceDocument, hasher: Hasher): Promise<MemoryChunk[]>`

### 2.4 EmbeddingProvider

**責務**: チャンク本文および検索クエリからEmbeddingベクトルを生成する。

- `embedPassage(text: string): Promise<Result<number[], EmbeddingError>>`
- `embedQuery(text: string): Promise<Result<number[], EmbeddingError>>`

### 2.5 MemoryStore

**責務**: `SourceDocument`、`MemoryChunk`、`EmbeddingCache`、`SourceEvent`の永続化、差分更新、全削除を担う。

- `loadAll(): Promise<Result<StoredSnapshot, StoreError>>`
- `saveBatch(snapshot: StoredSnapshot): Promise<Result<void, StoreError>>`
- `deleteSource(sourceId: string): Promise<Result<void, StoreError>>`
- `clearAll(): Promise<Result<void, StoreError>>`
- `syncRawFilesToStore(rawFiles: RawFile[], store: MemoryStore, hasher: Hasher, embeddingProvider: EmbeddingProvider): Promise<Result<SyncSummary, StoreError>>`

**契約**:

- `saveBatch`は`SourceEvent`を複合キー`(sourceId, eventType, timestamp)`で`put`する。同じキーは上書きされ、重複しない。
- `syncRawFilesToStore`は、取り込んだ全レコードの`SourceEvent`を保存する。保存済みの最新`timestamp`による読み飛ばしは行わない。
- `SourceEvent`は、正規化した`SourceDocument`の`sourceId`、`sourceTimestampKind`（`eventType`）、`sourceTimestamp`（`timestamp`）から作る。履歴・ブックマークの`originalLocator`には、`RawFile.path`（正規化前のURL）を設定する。
- 同じ`sourceId`のレコードが複数ある場合、`SourceDocument`は1件にまとめる。`sourceHash`が保存済みと同じ場合は、チャンクとEmbeddingを再生成しない。
- 取り込み後、`SourceDocument.sourceTimestamp`と`sourceTimestampKind`は、そのドキュメントの最新の`SourceEvent`の値に更新する。
- `deleteSource`は`SourceEvent`を削除しない。`clearAll`は`SourceEvent`を含むすべてのデータを削除する。
- `IndexedDbStore`は、v1のDBを開く際にDS 4章のv1→v2移行を実行する。移行に失敗した場合は`STORE_READ_FAILED`を返し、v1のデータを変更しない。
- `SyncSummary`に、取り込み後にStoreへ保持されているSourceEventの総件数（`eventsCount`）を追加する。

### 2.6 SearchIndex

**責務**: MemoryChunkとEmbeddingの登録、削除、キーワード検索およびRRFハイブリッド検索をメモリ上で行う。

- `create(): SearchIndex`
- `add(entries: SearchEntry[]): Result<void, IndexError>`
- `clear(): void`
- `search(query: string, options?: SearchOptions): Result<SearchResult[], SearchError>`

**契約**:

- `options.queryVector`が指定された場合、キーワード順位とコサイン類似度ベクトル順位をRRF（既定`k = 60`）で統合する。
- `options.topicId`が指定された場合、指定トピックに所属するチャンクのみへ結果を絞り込む。

### 2.7 TopicAnalyzer（Phase 3）

**責務**: チャンクのEmbeddingベクトルをクラスタリングし、代表トピック名を付与し、`SourceEvent`から月次タイムラインを集計する。

- `analyzeTopics(entries: SearchEntry[], events: SourceEvent[], options?: TopicOptions): Result<TopicAnalysisResult, TopicError>`

**契約**:

- チャンク件数が0件の場合は`TOPIC_INSUFFICIENT_DATA`を返す。
- 各チャンクのEmbeddingベクトル間のコサイン距離または類似度に基づき、ブラウザ内で完結するクラスタリング（リーダー・フォロワー法またはコサイン類似度閾値クラスタリング、目標クラスタ数3〜8個）を行う。
- 各クラスタの所属チャンクのタイトル、見出し、本文の頻出語（名詞・カタカナ語・重要2-3gram）から代表語を抽出し、トピックの`label`（例: 「設計・アーキテクチャ」「AI・機械学習」等）を決定する。
- クラスタ所属度として`score`（クラスタ重心とのコサイン類似度）を算出し、`TopicAssignment`を生成する。
- `SourceEvent.timestamp`（Unixミリ秒）を`YYYY-MM`形式の月次キーへマッピングし、月別・トピック別のEvent件数を集計して`MonthlyTopicCount[]`を返す。
- 各`SourceEvent`の代表トピックは、`sourceId`が一致するチャンクの`TopicAssignment.score`をトピックごとに合計し、合計が最大のトピックとする。Event 1件は代表トピックに1件として数え、按分しない。
- 参照先の`SourceDocument`が存在しない、または`TopicAssignment`がない`SourceEvent`は、トピックを「不明」として別に数える。
- 同日・同一URLの訪問は丸めず、件数をそのまま数える。
- 処理に失敗しても既存のインデックスやストアのデータを破壊しない。

### 2.8 GraphRenderer（Phase 3）

**責務**: 月次トピック推移データから外部ライブラリ非依存のSVG興味変遷グラフを生成し、DOMへ描画する。

- `renderTopicTimelineSvg(timeline: MonthlyTopicCount[], topics: Topic[], onSelectTopic?: (topicId: string | null) => void): SVGSVGElement`

**契約**:

- 外部ライブラリ（Chart.js、D3等）を読み込まず、ブラウザ標準のSVG DOM APIまたは純粋なSVG文字列生成で描画する。
- X軸に月次（`YYYY-MM`）、Y軸に出現チャンク数（または比率）をスタック棒グラフまたは積み上げ面グラフとして表示する。
- トピックごとに識別しやすいアクセシブルなカラーパレットを割り当て、トピック名凡例を表示する。
- 凡例またはバー要素をクリックした際、`onSelectTopic(topicId)`コールバックを呼び出し、該当トピックのチャンク一覧への検索絞り込みを可能にする。

## 3. 制御フロー

```mermaid
sequenceDiagram
    actor User as 利用者
    participant UI as 検索・可視化UI
    participant Store as MemoryStore
    participant Analyzer as TopicAnalyzer
    participant Renderer as GraphRenderer
    participant Index as SearchIndex

    UI->>Store: 起動時に保存済みデータを読込
    Store-->>UI: StoredSnapshot
    UI->>Index: SearchEntry[] をインデックスへ登録
    UI->>Analyzer: analyzeTopics(entries, events)
    Analyzer-->>UI: TopicAnalysisResult (topics, timeline)
    UI->>Renderer: renderTopicTimelineSvg(timeline, topics)
    Renderer-->>UI: SVGSVGElement
    UI-->>User: 検索UIと興味変遷グラフを表示
    User->>UI: グラフのトピックまたはバーをクリック
    UI->>Index: search("", { topicId })
    Index-->>UI: 該当トピックのSearchResult[]
    UI-->>User: トピック絞り込み結果を表示
```

## 4. エラー分類

| コード                     | 種別      | 発生条件                     | UIの扱い                                 |
| :------------------------- | :-------- | :--------------------------- | :--------------------------------------- |
| `DIRECTORY_READ_FAILED`    | 入力      | ディレクトリ列挙に失敗       | 読み込みを終了し再試行を表示             |
| `FILE_READ_FAILED`         | 入力      | 個別ファイルの読取・解析失敗 | 対象ファイル名を表示し他ファイルを継続   |
| `PATH_INVALID`             | 正規化    | 親参照・絶対パスなどを検出   | 対象ファイルを除外し通知する             |
| `URL_EXCLUDED`             | 正規化    | 非HTTP/HTTPSや不正URLを検出  | 対象レコードを除外し通知する             |
| `DOCUMENT_EMPTY`           | 正規化    | 本文が空                     | 対象Documentを検索対象外にする           |
| `EMBEDDING_EMPTY`          | Embedding | 空テキストのベクトル化要求   | 対象チャンクのベクトル生成をスキップ     |
| `EMBEDDING_INVALID_VECTOR` | Embedding | 次元不一致または非有限値     | 更新前の状態を維持しエラーを通知         |
| `EMBEDDING_FAILED`         | Embedding | モデル推論またはWorker失敗   | 更新前の状態を維持しエラーを通知         |
| `STORE_READ_FAILED`        | 永続化    | IndexedDBからの読込失敗      | メモリインデックスで継続し警告を表示     |
| `STORE_WRITE_FAILED`       | 永続化    | IndexedDBへの保存失敗        | 既存データを維持し再試行を案内           |
| `STORE_CLEAR_FAILED`       | 永続化    | IndexedDBの全削除失敗        | エラーを表示し再試行を案内               |
| `INDEX_SIZE_LIMIT`         | 検索      | 50,000チャンク超過           | フォルダまたは登録対象を絞って再実行する |
| `INDEX_BUILD_FAILED`       | 検索      | インデックス登録に失敗       | 更新前の状態を保持し再試行を案内         |
| `QUERY_EMPTY`              | 検索      | 検索語が空                   | 検索を実行せず入力を促す                 |
| `SEARCH_FAILED`            | 検索      | 検索処理に失敗               | インデックスを破棄せず再構築を案内       |
| `TOPIC_INSUFFICIENT_DATA`  | トピック  | 分析対象チャンクが不足       | グラフ描画をスキップしデータ投入を促す   |
| `TOPIC_ANALYSIS_FAILED`    | トピック  | クラスタリング・集計処理失敗 | 既存の検索機能を維持しエラーを表示       |

## 5. 非機能目標

| ID      | 目標         | 暫定値                                                    | 測定方法                        |
| :------ | :----------- | :-------------------------------------------------------- | :------------------------------ |
| NFR-001 | 初期検索応答 | 50,000チャンク以内で通常検索の結果を1秒以内に返す         | ブラウザのPerformance APIで計測 |
| NFR-002 | UI応答性     | 10,000チャンクまで初期登録中に操作不能時間を2秒以内にする | ブラウザ上で計測                |
| NFR-003 | トピック解析 | 5,000チャンクのクラスタリングと集計を1秒以内で完了する    | Performance APIで計測           |
| NFR-004 | グラフ描画   | SVGグラフの初回描画およびインタラクション応答100ms以内    | Performance APIで計測           |

## 6. Phase 3の完了条件

- チャンクのEmbeddingベクトルからブラウザ内でトピッククラスタリングを実行できる。
- 各クラスタに代表的なトピック名（ラベル）を自動抽出・命名できる。
- `SourceEvent`（更新・閲覧・登録の時刻）に基づいて月別のトピック出現推移を集計できる。
- SVGによる興味変遷グラフ（タイムライン・スタックバー）を描画し、月別・トピック別の関心の変化を確認できる。
- グラフやトピック選択に連動して検索結果の絞り込みができる。

## 7. 機能テスト要件（イベント蓄積）

| ID     | 対象                | 検証観点                                                                                               |
| :----- | :------------------ | :----------------------------------------------------------------------------------------------------- |
| TR-001 | Normalizer          | 同一URLで訪問時刻が異なる履歴3件を正規化すると、`sourceId`は同一で、`SourceEvent`は3件になる           |
| TR-002 | Normalizer          | `#fragment`、`utm_*`、`fbclid`、`gclid`を除いたURLが同一なら、同一の`sourceId`になる                   |
| TR-003 | Normalizer          | クエリ（上記以外）、末尾の`/`、`www.`が異なるURLは、別の`sourceId`になる                               |
| TR-004 | syncRawFilesToStore | 同じ入力を2回取り込んでも`SourceEvent`は重複せず、2回目のEmbedding生成は0件になる                      |
| TR-005 | syncRawFilesToStore | 同一URLで本文（タイトル）が変わった場合のみ、チャンクとEmbeddingを再生成する                           |
| TR-006 | syncRawFilesToStore | 取り込み後の`sourceTimestamp`が、最新の`SourceEvent`の`timestamp`と一致する                            |
| TR-007 | MemoryStore         | `deleteSource`の後も`SourceEvent`が残る。`clearAll`の後は`SourceEvent`も残らない                       |
| TR-008 | IndexedDbStore      | v1のDBを開くと、履歴由来のデータが削除され、Markdownとブックマークの検索結果が変わらない               |
| TR-009 | TopicAnalyzer       | `timeline`の件数が`SourceEvent`の件数と一致し、チャンクスコア合計が最大のトピックに1件として数えられる |
| TR-010 | TopicAnalyzer       | 参照先の`SourceDocument`がない`SourceEvent`が「不明」として数えられる                                  |
