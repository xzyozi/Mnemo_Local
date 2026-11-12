import type {
  IndexError,
  Result,
  SearchEntry,
  SearchError,
  SearchOptions,
  SearchResult,
} from "./domain.js";

const MAX_CHUNKS = 50_000;
const DEFAULT_RRF_K = 60;

type IndexedEntry = SearchEntry & {
  normalizedText: string;
  grams2: Set<string>;
  grams3: Set<string>;
};

const normalizeText = (value: string): string => value.normalize("NFKC").toLocaleLowerCase("ja-JP");

const grams = (value: string, size: number): Set<string> =>
  new Set(
    Array.from({ length: Math.max(0, value.length - size + 1) }, (_, index) =>
      value.slice(index, index + size),
    ),
  );

const scoreText = (entry: IndexedEntry, query: string): number => {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length === 1) return entry.normalizedText.includes(normalizedQuery) ? 1 : 0;
  const queryGrams = grams(normalizedQuery, normalizedQuery.length === 2 ? 2 : 3);
  const indexedGrams = normalizedQuery.length === 2 ? entry.grams2 : entry.grams3;
  if (queryGrams.size === 0) return 0;
  return [...queryGrams].filter((gram) => indexedGrams.has(gram)).length / queryGrams.size;
};

export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i] ?? 0;
    const valB = b[i] ?? 0;
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
};

export class SearchIndex {
  private entries: IndexedEntry[] = [];

  add(entries: SearchEntry[]): Result<void, IndexError> {
    if (this.entries.length + entries.length > MAX_CHUNKS)
      return { ok: false, error: "INDEX_SIZE_LIMIT" };
    try {
      const indexed = entries.map((entry) => {
        const normalizedText = normalizeText(
          `${entry.source.title}\n${entry.chunk.body}\n${entry.source.sourceLocator}`,
        );
        return {
          ...entry,
          normalizedText,
          grams2: grams(normalizedText, 2),
          grams3: grams(normalizedText, 3),
        };
      });
      this.entries = [...this.entries, ...indexed];
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: "INDEX_BUILD_FAILED" };
    }
  }

  clear(): void {
    this.entries = [];
  }

  search(query: string, options: SearchOptions = {}): Result<SearchResult[], SearchError> {
    if (!query.trim()) return { ok: false, error: "QUERY_EMPTY" };
    try {
      const filtered = this.entries
        .filter(({ source }) => !options.sourceIds || options.sourceIds.includes(source.sourceId))
        .filter(
          ({ source }) => !options.sourceTypes || options.sourceTypes.includes(source.sourceType),
        )
        .filter(
          ({ source }) =>
            options.updatedAfter === undefined || source.sourceTimestamp >= options.updatedAfter,
        )
        .filter(
          ({ source }) =>
            options.updatedBefore === undefined || source.sourceTimestamp <= options.updatedBefore,
        );

      const rrfK = options.rrfK ?? DEFAULT_RRF_K;
      const queryVector = options.queryVector;

      let results: SearchResult[];

      if (queryVector && queryVector.length > 0) {
        // Hybrid Search using Reciprocal Rank Fusion (RRF)
        // 1. Keyword rank
        const keywordScored = filtered
          .map((entry) => ({ entry, score: scoreText(entry, query) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score);

        const keywordRankMap = new Map<string, number>();
        for (let i = 0; i < keywordScored.length; i++) {
          const item = keywordScored[i];
          if (item) keywordRankMap.set(item.entry.chunk.chunkId, i + 1);
        }

        // 2. Vector rank
        const vectorScored = filtered
          .filter(({ embedding }) => Boolean(embedding?.vector))
          .map((entry) => ({
            entry,
            sim: entry.embedding ? cosineSimilarity(entry.embedding.vector, queryVector) : 0,
          }))
          .filter(({ sim }) => sim > 0)
          .sort((a, b) => b.sim - a.sim);

        const vectorRankMap = new Map<string, number>();
        for (let i = 0; i < vectorScored.length; i++) {
          const item = vectorScored[i];
          if (item) vectorRankMap.set(item.entry.chunk.chunkId, i + 1);
        }

        // 3. Combine scores
        const candidateIds = new Set([
          ...keywordRankMap.keys(),
          ...vectorRankMap.keys(),
        ]);
        const entryMap = new Map(filtered.map((e) => [e.chunk.chunkId, e]));

        const combined: SearchResult[] = [];
        for (const chunkId of candidateIds) {
          const entry = entryMap.get(chunkId);
          if (!entry) continue;

          let rrfScore = 0;
          const kRank = keywordRankMap.get(chunkId);
          if (kRank !== undefined) {
            rrfScore += 1 / (rrfK + kRank);
          }
          const vRank = vectorRankMap.get(chunkId);
          if (vRank !== undefined) {
            rrfScore += 1 / (rrfK + vRank);
          }

          combined.push({
            chunkId: entry.chunk.chunkId,
            sourceId: entry.source.sourceId,
            title: entry.source.title,
            snippet: entry.chunk.body.slice(0, 180),
            sourceLocator: entry.source.sourceLocator,
            sourceTimestamp: entry.source.sourceTimestamp,
            score: rrfScore,
          });
        }

        results = combined.sort(
          (left, right) =>
            right.score - left.score ||
            right.sourceTimestamp - left.sourceTimestamp ||
            left.chunkId.localeCompare(right.chunkId),
        );
      } else {
        // Keyword-only search
        results = filtered
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
          .sort(
            (left, right) =>
              right.score - left.score ||
              right.sourceTimestamp - left.sourceTimestamp ||
              left.chunkId.localeCompare(right.chunkId),
          );
      }

      return { ok: true, value: results };
    } catch {
      return { ok: false, error: "SEARCH_FAILED" };
    }
  }
}
