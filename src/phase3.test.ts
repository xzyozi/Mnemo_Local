import { describe, expect, it } from "vitest";
import type { SearchEntry, SourceDocument, SourceEvent } from "./domain.js";
import { generateTopicTimelineSvg, renderTopicTimelineSvg } from "./graph-renderer.js";
import { SearchIndex } from "./search.js";
import { analyzeTopics } from "./topic-analyzer.js";

const createEntry = (
  id: string,
  title: string,
  body: string,
  timestamp: number,
  vector: number[],
): SearchEntry => {
  const source: SourceDocument = {
    sourceId: `src_${id}`,
    sourceType: "markdown",
    sourceLocator: `notes/${id}.md`,
    title,
    body,
    sourceTimestamp: timestamp,
    sourceTimestampKind: "updated",
    sourceHash: `hash_src_${id}`,
    schemaVersion: "1",
  };
  return {
    source,
    chunk: {
      chunkId: `chk_${id}`,
      sourceId: source.sourceId,
      ordinal: 0,
      body,
      contentHash: `hash_chk_${id}`,
      charStart: 0,
      charEnd: body.length,
      schemaVersion: "1",
    },
    embedding: {
      chunkId: `chk_${id}`,
      modelId: "test-model",
      dimensions: vector.length,
      vector,
      generatedAt: new Date(timestamp).toISOString(),
    },
  };
};

const eventsFor = (entries: SearchEntry[]): SourceEvent[] =>
  entries.map((entry) => ({
    sourceId: entry.source.sourceId,
    eventType: entry.source.sourceTimestampKind,
    timestamp: entry.source.sourceTimestamp,
  }));

it("returns TOPIC_INSUFFICIENT_DATA when entries are empty or have no vectors", () => {
  expect(analyzeTopics([], [])).toEqual({
    ok: false,
    error: "TOPIC_INSUFFICIENT_DATA",
  });

  const noVectorEntry: SearchEntry = {
    source: {
      sourceId: "src_1",
      sourceType: "markdown",
      sourceLocator: "notes/1.md",
      title: "Test",
      body: "Test body",
      sourceTimestamp: 1000,
      sourceTimestampKind: "updated",
      sourceHash: "hash1",
      schemaVersion: "1",
    },
    chunk: {
      chunkId: "chk_1",
      sourceId: "src_1",
      ordinal: 0,
      body: "Test body",
      contentHash: "hash2",
      charStart: 0,
      charEnd: 9,
      schemaVersion: "1",
    },
  };
  expect(analyzeTopics([noVectorEntry], [])).toEqual({
    ok: false,
    error: "TOPIC_INSUFFICIENT_DATA",
  });
});

it("clusters entries by embedding similarity and generates meaningful topic labels", () => {
  // 2 clusters:
  // AI cluster (vector [1, 0, 0, 0])
  // Web cluster (vector [0, 1, 0, 0])
  const time2026_01 = Date.UTC(2026, 0, 15);
  const time2026_02 = Date.UTC(2026, 1, 15);

  const entries: SearchEntry[] = [
    createEntry(
      "ai1",
      "機械学習入門",
      "深層学習とニューラルネットワークのアーキテクチャ",
      time2026_01,
      [0.99, 0.05, 0, 0],
    ),
    createEntry(
      "ai2",
      "深層学習の最適化",
      "学習率と勾配降下法によるモデル精度向上",
      time2026_02,
      [0.95, 0.1, 0, 0],
    ),
    createEntry(
      "web1",
      "React設計手法",
      "フロントエンドのコンポーネント指向設計と状態管理",
      time2026_01,
      [0.05, 0.98, 0, 0],
    ),
    createEntry(
      "web2",
      "TypeScript基礎",
      "型システムを活用したフロントエンドコンポーネント開発",
      time2026_02,
      [0.1, 0.95, 0, 0],
    ),
  ];

  const res = analyzeTopics(entries, eventsFor(entries), { maxClusters: 3, minSimilarity: 0.6 });
  expect(res.ok).toBe(true);
  if (!res.ok) return;

  const { topics, assignments, timeline } = res.value;
  expect(topics.length).toBe(2);
  expect(assignments.length).toBe(4);

  // Each assignment should have a valid topic and positive score
  for (const asmt of assignments) {
    expect(asmt.score).toBeGreaterThan(0.8);
    expect(topics.some((t) => t.topicId === asmt.topicId)).toBe(true);
  }

  // AI chunks should share the same topic
  const ai1Asmt = assignments.find((a) => a.chunkId === "chk_ai1");
  const ai2Asmt = assignments.find((a) => a.chunkId === "chk_ai2");
  expect(ai1Asmt?.topicId).toBe(ai2Asmt?.topicId);

  // Web chunks should share the same topic
  const web1Asmt = assignments.find((a) => a.chunkId === "chk_web1");
  const web2Asmt = assignments.find((a) => a.chunkId === "chk_web2");
  expect(web1Asmt?.topicId).toBe(web2Asmt?.topicId);
  expect(ai1Asmt?.topicId).not.toBe(web1Asmt?.topicId);

  // Timeline should have 2026-01 and 2026-02
  expect(timeline.length).toBe(2);
  expect(timeline[0]?.month).toBe("2026-01");
  expect(timeline[0]?.total).toBe(4);
  expect(timeline[1]?.month).toBe("2026-02");
  expect(timeline[1]?.total).toBe(4);
});

it("generates valid SVG markup with bars and legend", () => {
  const timeline = [
    {
      month: "2026-01",
      counts: { "topic-1": 3, "topic-2": 1 },
      total: 4,
    },
    {
      month: "2026-02",
      counts: { "topic-1": 1, "topic-2": 5 },
      total: 6,
    },
  ];
  const topics = [
    {
      topicId: "topic-1",
      label: "機械学習・深層学習",
      algorithmVersion: "1.0",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      topicId: "topic-2",
      label: "フロントエンド・React",
      algorithmVersion: "1.0",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const svg = generateTopicTimelineSvg(timeline, topics);
  expect(svg).toContain("<svg");
  expect(svg).toContain("</svg>");
  expect(svg).toContain("2026-01");
  expect(svg).toContain("2026-02");
  expect(svg).toContain("機械学習・深層学習");
  expect(svg).toContain("フロントエンド・React");
  expect(svg).toContain('data-topic-id="topic-1"');
  expect(svg).toContain('data-topic-id="topic-2"');

  // Selected topic highlights that topic
  const highlightedSvg = generateTopicTimelineSvg(timeline, topics, "topic-1");
  expect(highlightedSvg).toContain('data-topic-id="topic-1"');
  expect(highlightedSvg).toContain('opacity="0.2"'); // unselected has lower opacity

  // Empty fallback
  const emptySvg = generateTopicTimelineSvg([], []);
  expect(emptySvg).toContain("データがありません");

  // renderTopicTimelineSvg should not throw in non-browser environment
  const element = renderTopicTimelineSvg(timeline, topics);
  expect(element).toBeDefined();
});

it("filters search results by topicId", () => {
  const index = new SearchIndex();
  const entry1 = createEntry("1", "AIモデル", "深層学習の概要", 1000, [1, 0]);
  const entry2 = createEntry("2", "AI応用", "自然言語処理の応用", 2000, [1, 0]);
  const entry3 = createEntry("3", "Web開発", "TypeScriptの使い方", 3000, [0, 1]);

  index.add([entry1, entry2, entry3]);
  index.setTopicAssignments([
    { assignmentId: "a1", chunkId: "chk_1", topicId: "topic-ai", score: 0.9 },
    { assignmentId: "a2", chunkId: "chk_2", topicId: "topic-ai", score: 0.95 },
    { assignmentId: "a3", chunkId: "chk_3", topicId: "topic-web", score: 0.88 },
  ]);

  // Query empty with topicId returns all entries in that topic
  const topicOnlyResult = index.search("", { topicId: "topic-ai" });
  expect(topicOnlyResult.ok).toBe(true);
  if (!topicOnlyResult.ok) return;
  expect(topicOnlyResult.value.length).toBe(2);
  expect(topicOnlyResult.value.map((r) => r.chunkId).sort()).toEqual(["chk_1", "chk_2"]);

  // Query with keyword + topicId filters to topic
  const filteredSearch = index.search("言語", { topicId: "topic-ai" });
  expect(filteredSearch.ok).toBe(true);
  if (!filteredSearch.ok) return;
  expect(filteredSearch.value.length).toBe(1);
  expect(filteredSearch.value[0]?.chunkId).toBe("chk_2");

  // Empty query without topicId fails with QUERY_EMPTY
  expect(index.search("")).toEqual({
    ok: false,
    error: "QUERY_EMPTY",
  });
});

describe("Phase 3 boundary cases", () => {
  it("falls back to a generated label when keyword candidates are absent", () => {
    const entry = createEntry("empty", "", "", Date.UTC(2026, 0, 1), [1, 0]);
    const result = analyzeTopics([entry], eventsFor([entry]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.topics[0]?.label).toBe("トピック 1");
  });

  it("respects maxClusters and keeps every valid assignment", () => {
    const entries = [
      createEntry("a", "A", "A", Date.UTC(2026, 0, 1), [1, 0]),
      createEntry("b", "B", "B", Date.UTC(2026, 0, 2), [0, 1]),
      createEntry("c", "C", "C", Date.UTC(2026, 0, 3), [-1, 0]),
    ];
    const result = analyzeTopics(entries, eventsFor(entries), { maxClusters: 1, minSimilarity: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.topics).toHaveLength(1);
    expect(result.value.assignments).toHaveLength(entries.length);
  });

  it("uses UTC months and falls back invalid timestamps to 1970-01", () => {
    const invalidEntry = createEntry("invalid", "Invalid", "本文", Date.UTC(2026, 0, 1), [1, 0]);
    invalidEntry.source.sourceTimestamp = Number.NaN;
    const validEntry = createEntry(
      "valid",
      "Valid",
      "本文",
      Date.UTC(2026, 11, 31, 23, 30),
      [1, 0],
    );
    const entries = [validEntry, invalidEntry];
    const result = analyzeTopics(entries, eventsFor(entries));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.timeline.map((item) => item.month)).toEqual(["1970-01", "2026-12"]);
  });

  it("escapes external values in SVG markup", () => {
    const svg = generateTopicTimelineSvg(
      [{ month: "2026-01<&", counts: { "topic<&": 1 }, total: 1 }],
      [
        {
          topicId: "topic<&",
          label: "<script>alert(1)</script>",
          algorithmVersion: "1",
          createdAt: "2026-01-01",
        },
      ],
    );
    expect(svg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(svg).not.toContain("<script>alert(1)</script>");
    expect(svg).toContain("topic&lt;&amp;");
  });
});
