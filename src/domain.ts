export type SourceType = 'markdown';

export interface RawFile {
  path: string;
  title: string;
  body: string;
  updatedAt: number;
}

export interface SourceDocument {
  sourceId: string;
  sourceType: SourceType;
  sourceLocator: string;
  title: string;
  body: string;
  sourceTimestamp: number;
  sourceTimestampKind: 'updated';
  sourceHash: string;
  schemaVersion: '1';
}

export interface MemoryChunk {
  chunkId: string;
  sourceId: string;
  ordinal: number;
  body: string;
  contentHash: string;
  charStart: number;
  charEnd: number;
  schemaVersion: '1';
}

export interface SearchEntry {
  chunk: MemoryChunk;
  source: SourceDocument;
}

export interface SearchOptions {
  sourceIds?: string[];
  updatedAfter?: number;
  updatedBefore?: number;
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

export type NormalizeError = 'PATH_INVALID' | 'DOCUMENT_EMPTY';
export type IndexError = 'INDEX_SIZE_LIMIT' | 'INDEX_BUILD_FAILED';
export type SearchError = 'QUERY_EMPTY' | 'SEARCH_FAILED';
