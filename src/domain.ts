export type SourceType = "markdown" | "history" | "bookmark";

export type SourceTimestampKind = "updated" | "visited" | "created";

export interface RawFile {
  path: string;
  title: string;
  body: string;
  updatedAt: number;
  sourceType?: SourceType;
  sourceTimestampKind?: SourceTimestampKind;
}

export interface SourceDocument {
  sourceId: string;
  sourceType: SourceType;
  sourceLocator: string;
  title: string;
  body: string;
  sourceTimestamp: number;
  sourceTimestampKind: SourceTimestampKind;
  sourceHash: string;
  schemaVersion: "1";
}

export interface MemoryChunk {
  chunkId: string;
  sourceId: string;
  ordinal: number;
  body: string;
  contentHash: string;
  charStart: number;
  charEnd: number;
  schemaVersion: "1";
}

export interface EmbeddingCache {
  chunkId: string;
  modelId: string;
  dimensions: number;
  vector: number[];
  generatedAt: string;
}

export interface SearchEntry {
  chunk: MemoryChunk;
  source: SourceDocument;
  embedding?: EmbeddingCache;
}

export interface SearchOptions {
  sourceIds?: string[];
  sourceTypes?: SourceType[];
  updatedAfter?: number;
  updatedBefore?: number;
  queryVector?: number[];
  rrfK?: number;
}

export interface SearchResult {
  chunkId: string;
  sourceId: string;
  title: string;
  snippet: string;
  sourceLocator: string;
  sourceTimestamp: number;
  score: number;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type NormalizeError = "PATH_INVALID" | "URL_EXCLUDED" | "DOCUMENT_EMPTY";
export type EmbeddingError = "EMBEDDING_EMPTY" | "EMBEDDING_INVALID_VECTOR" | "EMBEDDING_FAILED";
export type StoreError = "STORE_READ_FAILED" | "STORE_WRITE_FAILED" | "STORE_CLEAR_FAILED";
export type IndexError = "INDEX_SIZE_LIMIT" | "INDEX_BUILD_FAILED";
export type SearchError = "QUERY_EMPTY" | "SEARCH_FAILED";
