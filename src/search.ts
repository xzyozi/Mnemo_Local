import type {
  IndexError,
  Result,
  SearchEntry,
  SearchError,
  SearchOptions,
  SearchResult,
} from './domain.js';

const MAX_CHUNKS = 50_000;

type IndexedEntry = SearchEntry & {
  normalizedText: string;
  grams2: Set<string>;
  grams3: Set<string>;
};

const normalizeText = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('ja-JP');
const grams = (value: string, size: number): Set<string> =>
  new Set(Array.from({ length: Math.max(0, value.length - size + 1) }, (_, index) => value.slice(index, index + size)));

const scoreText = (entry: IndexedEntry, query: string): number => {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length === 1) return entry.normalizedText.includes(normalizedQuery) ? 1 : 0;
  const queryGrams = grams(normalizedQuery, normalizedQuery.length === 2 ? 2 : 3);
  const indexedGrams = normalizedQuery.length === 2 ? entry.grams2 : entry.grams3;
  if (queryGrams.size === 0) return 0;
  return [...queryGrams].filter((gram) => indexedGrams.has(gram)).length / queryGrams.size;
};

export class SearchIndex {
  private entries: IndexedEntry[] = [];

  add(entries: SearchEntry[]): Result<void, IndexError> {
    if (this.entries.length + entries.length > MAX_CHUNKS) return { ok: false, error: 'INDEX_SIZE_LIMIT' };
    try {
      const indexed = entries.map((entry) => {
        const normalizedText = normalizeText(`${entry.source.title}\n${entry.chunk.body}\n${entry.source.sourceLocator}`);
        return { ...entry, normalizedText, grams2: grams(normalizedText, 2), grams3: grams(normalizedText, 3) };
      });
      this.entries = [...this.entries, ...indexed];
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
        .map((entry) => ({ entry, score: scoreText(entry, query) }))
        .filter(({ score }) => score > 0)
        .map(({ entry, score }) => ({
          chunkId: entry.chunk.chunkId,
          sourceId: entry.source.sourceId,
          title: entry.source.title,
          snippet: entry.chunk.body.slice(0, 180),
          sourceLocator: entry.source.sourceLocator,
          sourceTimestamp: entry.source.sourceTimestamp,
          score,
        }))
        .sort((left, right) => right.score - left.score || right.sourceTimestamp - left.sourceTimestamp || left.chunkId.localeCompare(right.chunkId));
      return { ok: true, value: results };
    } catch {
      return { ok: false, error: 'SEARCH_FAILED' };
    }
  }
}
