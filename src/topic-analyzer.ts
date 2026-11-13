import type {
  MonthlyTopicCount,
  Result,
  SearchEntry,
  SourceEvent,
  Topic,
  TopicAnalysisResult,
  TopicAssignment,
  TopicError,
  TopicOptions,
} from "./domain.js";
import { cosineSimilarity } from "./search.js";

const DEFAULT_MAX_CLUSTERS = 5;
const DEFAULT_MIN_SIMILARITY = 0.65;
const STOP_WORDS = new Set([
  "これ",
  "それ",
  "あれ",
  "どれ",
  "こと",
  "もの",
  "ため",
  "よう",
  "とき",
  "場合",
  "必要",
  "確認",
  "使用",
  "利用",
  "実行",
  "作成",
  "追加",
  "削除",
  "更新",
  "変更",
  "対応",
  "結果",
  "処理",
  "機能",
  "データ",
  "ファイル",
  "情報",
  "http",
  "https",
  "www",
  "com",
  "org",
  "net",
  "null",
  "undefined",
  "true",
  "false",
]);

const extractKeywords = (text: string): string[] => {
  const words: string[] = [];
  const katakana = text.match(/[ァ-ヶー]{2,}/g) ?? [];
  const kanji = text.match(/[一-龠]{2,}/g) ?? [];
  const ascii = text.match(/[A-Za-z0-9_]{3,}/g) ?? [];

  for (const w of [...katakana, ...kanji, ...ascii]) {
    const lower = w.toLowerCase();
    if (!STOP_WORDS.has(lower) && !STOP_WORDS.has(w)) {
      words.push(w);
    }
  }
  return words;
};

const normalizeVector = (vector: number[]): number[] => {
  let norm = 0;
  for (const v of vector) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
};

const computeCentroid = (vectors: number[][]): number[] => {
  if (vectors.length === 0) return [];
  const dim = vectors[0]?.length ?? 0;
  const sum = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      const val = vec[i] ?? 0;
      const currentSum = sum[i] ?? 0;
      sum[i] = currentSum + val;
    }
  }
  return normalizeVector(sum.map((v) => v / vectors.length));
};

const formatMonth = (timestamp: number): string => {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "1970-01";
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

export const analyzeTopics = (
  entries: SearchEntry[],
  events: SourceEvent[],
  options: TopicOptions = {},
): Result<TopicAnalysisResult, TopicError> => {
  if (!entries || entries.length === 0) {
    return { ok: false, error: "TOPIC_INSUFFICIENT_DATA" };
  }

  try {
    const validEntries = entries.filter(
      (e) => e.embedding && Array.isArray(e.embedding.vector) && e.embedding.vector.length > 0,
    );

    if (validEntries.length === 0) {
      return { ok: false, error: "TOPIC_INSUFFICIENT_DATA" };
    }

    const maxClusters = Math.max(1, options.maxClusters ?? DEFAULT_MAX_CLUSTERS);
    const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

    interface RawCluster {
      id: string;
      centroid: number[];
      entries: SearchEntry[];
    }

    const clusters: RawCluster[] = [];

    // Leader-Follower Clustering
    for (const entry of validEntries) {
      const vec = entry.embedding?.vector;
      if (!vec) continue;

      if (clusters.length === 0) {
        clusters.push({
          id: `topic-${clusters.length + 1}`,
          centroid: normalizeVector(vec),
          entries: [entry],
        });
        continue;
      }

      let bestIdx = -1;
      let bestSim = -1;
      for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i];
        if (!cluster) continue;
        const sim = cosineSimilarity(vec, cluster.centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }

      if (bestSim >= minSimilarity || clusters.length >= maxClusters) {
        const targetCluster = clusters[bestIdx >= 0 ? bestIdx : 0];
        if (targetCluster) {
          targetCluster.entries.push(entry);
          const allVecs = targetCluster.entries
            .map((e) => e.embedding?.vector)
            .filter((v): v is number[] => Boolean(v));
          targetCluster.centroid = computeCentroid(allVecs);
        }
      } else {
        clusters.push({
          id: `topic-${clusters.length + 1}`,
          centroid: normalizeVector(vec),
          entries: [entry],
        });
      }
    }

    // Refinement pass: reassign each entry to closest centroid
    const centroids = clusters.map((c) => c.centroid);
    const reassigned: SearchEntry[][] = clusters.map(() => []);

    for (const entry of validEntries) {
      const vec = entry.embedding?.vector;
      if (!vec) continue;

      let bestIdx = 0;
      let bestSim = -1;
      for (let i = 0; i < centroids.length; i++) {
        const centroid = centroids[i];
        if (!centroid) continue;
        const sim = cosineSimilarity(vec, centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }
      reassigned[bestIdx]?.push(entry);
    }

    // Update clusters with reassigned entries and final centroid
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      if (!cluster) continue;
      const entriesForCluster = reassigned[i] ?? [];
      cluster.entries = entriesForCluster;
      const clusterVecs = entriesForCluster
        .map((e) => e.embedding?.vector)
        .filter((v): v is number[] => Boolean(v));
      if (clusterVecs.length > 0) {
        cluster.centroid = computeCentroid(clusterVecs);
      }
    }

    // Filter out any empty clusters
    const activeClusters = clusters.filter((c) => c.entries.length > 0);
    if (activeClusters.length === 0) {
      return { ok: false, error: "TOPIC_INSUFFICIENT_DATA" };
    }

    // Term frequency across all clusters for TF-IDF naming
    const clusterTermCounts: Map<string, number>[] = [];
    const globalTermDocCount = new Map<string, number>();

    for (const cluster of activeClusters) {
      const termCount = new Map<string, number>();
      const seenInCluster = new Set<string>();

      for (const entry of cluster.entries) {
        const titleWords = extractKeywords(entry.source.title);
        const bodyWords = extractKeywords(entry.chunk.body);

        for (const w of titleWords) {
          termCount.set(w, (termCount.get(w) ?? 0) + 3);
          seenInCluster.add(w);
        }
        for (const w of bodyWords) {
          termCount.set(w, (termCount.get(w) ?? 0) + 1);
          seenInCluster.add(w);
        }
      }

      clusterTermCounts.push(termCount);
      for (const w of seenInCluster) {
        globalTermDocCount.set(w, (globalTermDocCount.get(w) ?? 0) + 1);
      }
    }

    const topics: Topic[] = [];
    const assignments: TopicAssignment[] = [];
    const nowIso = new Date().toISOString();

    for (let i = 0; i < activeClusters.length; i++) {
      const cluster = activeClusters[i];
      if (!cluster) continue;
      const termCount = clusterTermCounts[i] ?? new Map<string, number>();

      // Score terms by TF / global count
      const scoredTerms: { term: string; score: number }[] = [];
      for (const [term, count] of termCount.entries()) {
        const globalCount = globalTermDocCount.get(term) ?? 1;
        const score = count / (globalCount * 0.5 + 0.5);
        scoredTerms.push({ term, score });
      }

      scoredTerms.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
      const topWords = scoredTerms.slice(0, 2).map((st) => st.term);
      const label = topWords.length > 0 ? topWords.join("・") : `トピック ${i + 1}`;

      topics.push({
        topicId: cluster.id,
        label,
        algorithmVersion: "1.0",
        createdAt: nowIso,
      });

      for (const entry of cluster.entries) {
        const vec = entry.embedding?.vector;
        const score = vec ? cosineSimilarity(vec, cluster.centroid) : 1;
        assignments.push({
          assignmentId: `asmt_${entry.chunk.chunkId}_${cluster.id}`,
          chunkId: entry.chunk.chunkId,
          topicId: cluster.id,
          score,
        });
      }
    }

    // Generate monthly timeline from SourceEvent, assigning each event to its representative topic.
    const assignmentByChunk = new Map(assignments.map((assignment) => [assignment.chunkId, assignment]));
    const entriesBySource = new Map<string, SearchEntry[]>();
    for (const entry of validEntries) {
      const sourceEntries = entriesBySource.get(entry.source.sourceId) ?? [];
      sourceEntries.push(entry);
      entriesBySource.set(entry.source.sourceId, sourceEntries);
    }
    const topicBySource = new Map<string, Map<string, number>>();
    for (const [sourceId, sourceEntries] of entriesBySource) {
      const scores = new Map<string, number>();
      for (const entry of sourceEntries) {
        const assignment = assignmentByChunk.get(entry.chunk.chunkId);
        if (assignment) scores.set(assignment.topicId, (scores.get(assignment.topicId) ?? 0) + assignment.score);
      }
      topicBySource.set(sourceId, scores);
    }

    const unknownTopicId = "unknown";
    const monthMap = new Map<string, Record<string, number>>();
    for (const event of events) {
      const scores = topicBySource.get(event.sourceId);
      const representative = scores && [...scores.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
      const topicId = representative ?? unknownTopicId;
      const month = formatMonth(event.timestamp);
      const counts = monthMap.get(month) ?? {};
      counts[topicId] = (counts[topicId] ?? 0) + 1;
      monthMap.set(month, counts);
    }

    if ([...monthMap.values()].some((counts) => counts[unknownTopicId])) {
      topics.push({ topicId: unknownTopicId, label: "不明", algorithmVersion: "1.0", createdAt: new Date().toISOString() });
    }

    const timeline: MonthlyTopicCount[] = [];
    for (const month of [...monthMap.keys()].sort()) {
      const counts = monthMap.get(month) ?? {};
      timeline.push({ month, counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) });
    }

    return {
      ok: true,
      value: {
        topics,
        assignments,
        timeline,
      },
    };
  } catch {
    return { ok: false, error: "TOPIC_ANALYSIS_FAILED" };
  }
};
