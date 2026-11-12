import type {
  IndexError,
  Result,
  SearchEntry,
  SearchError,
  SearchOptions,
  SearchResult,
} from './domain.js';

const MAX_CHUNKS = 50_000;
const normalizeText = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('ja-JP');
const grams = (value: string, size: number): string[] =>
  Array.from({ length: Math.max(0, value.length - size + 1) }, (_, index) => value.slice(index, index + size));

const scoreText = (text: string, query: string): number => {
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length === 1) return normalizedText.includes(normalizedQuery) ? 1 : 0;
  const size = normalizedQuery.length === 2 ? 2 : 3;
  const queryGrams = grams(normalizedQuery, size);
  if (queryGrams.length === 0) return 0;
  return queryGrams.filter((gram) => normalizedText.includes(gram)).length / queryGrams.length;
};

export class SearchIndex {
  private entries: SearchEntry[] = [];

  add(entries: SearchEntry[]): Result<void, IndexError> {
    if (this.entries.length + entries.length > MAX_CHUNKS) return { ok: false, error: 'INDEX_SIZE_LIMIT' };
    try {
      this.entries = [...this.entries, ...entries];
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: 'INDEX_BUILD_FAILED' };
    }
  }

  clear(): void {
    this.entries = [];
  }

  search(query: string, options: SearchOptions = {}): Result<SearchResult[], SearchError> {
    if (!query.trim()) return { ok: false, error: 'QUERY_EMPTY' };
    try {
      const results = this.entries
        .filter(({ source }) => !options.sourceIds || options.sourceIds.includes(source.sourceId))
        .filter(({ source }) => options.updatedAfter === undefined || source.sourceTimestamp >= options.updatedAfter)
        .filter(({ source }) => options.updatedBefore === undefined || source.sourceTimestamp <= options.updatedBefore)
        .map(({ chunk, source }) => ({
          chunkId: chunk.chunkId,
          sourceId: source.sourceId,
          title: source.title,
          snippet: chunk.body.slice(0, 180),
          sourceLocator: source.sourceLocator,
          sourceTimestamp: source.sourceTimestamp,
          score: scoreText(`${source.title}\n${chunk.body}\n${source.sourceLocator}`, query),
        }))
        .filter((result) => result.score > 0)
        .sort((left, right) => right.score - left.score || right.sourceTimestamp - left.sourceTimestamp || left.chunkId.localeCompare(right.chunkId));
      return { ok: true, value: results };
    } catch {
      return { ok: false, error: 'SEARCH_FAILED' };
    }
  }
}
