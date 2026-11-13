import { describe, expect, it } from "vitest";
import type { RawFile } from "./domain.js";
import { DeterministicEmbeddingProvider } from "./embedding.js";
import type { Hasher } from "./hasher.js";
import { normalize, normalizeUrl } from "./normalize.js";
import { InMemoryStore, syncRawFilesToStore } from "./store.js";

const fakeHasher: Hasher = {
  async digest(value) {
    return `hash:${value}`;
  },
};

const history = (
  timestamp: number,
  url = "https://Example.com/article?utm_source=x&keep=1#section",
): RawFile => ({
  path: url,
  title: "記事タイトル",
  body: "ignored by normalizer",
  updatedAt: timestamp,
  sourceType: "history",
  sourceTimestampKind: "visited",
});

describe("Issue #9 content events", () => {
  it("normalizes tracking parameters while preserving other query and slash details", () => {
    expect(normalizeUrl("https://Example.com/a/?utm_source=x&fbclid=f&gclid=g&keep=1#part")).toBe(
      "https://example.com/a/?keep=1",
    );
    expect(normalizeUrl("https://www.example.com/a")).not.toBe(
      normalizeUrl("https://example.com/a"),
    );
    expect(normalizeUrl("https://example.com/a/?q=a?b&keep=1#part?x=1")).toBe(
      "https://example.com/a/?q=a?b&keep=1",
    );
    expect(normalizeUrl("https://example.com/a/?keep=1")).not.toBe(
      normalizeUrl("https://example.com/a?keep=1"),
    );
    expect(normalizeUrl("https://example.com/a?keep=1")).not.toBe(
      normalizeUrl("https://example.com/a?keep=2"),
    );
    expect(() => normalizeUrl("https://example.com/a?bad=%E0%A4%A")).not.toThrow();
  });

  it("uses one source document and one event per visit", async () => {
    const first = await normalize(history(1000), fakeHasher);
    const second = await normalize(history(2000), fakeHasher);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.sourceId).toBe(second.value.sourceId);
    expect(first.value.body).toBe("記事タイトル example.com/article");
  });

  it("stores events idempotently and reuses embeddings", async () => {
    const store = new InMemoryStore();
    const provider = new DeterministicEmbeddingProvider("test", 8);
    const files = [history(1000), history(2000), history(2000)];
    const first = await syncRawFilesToStore(files, store, fakeHasher, provider);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.eventsCount).toBe(2);
    expect(first.value.newEmbeddingsCount).toBeGreaterThan(0);

    const second = await syncRawFilesToStore(files, store, fakeHasher, provider);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.eventsCount).toBe(2);
    expect(second.value.newEmbeddingsCount).toBe(0);
  });

  it("keeps events after deleting a source and clears them with clearAll", async () => {
    const store = new InMemoryStore();
    const provider = new DeterministicEmbeddingProvider("test", 8);
    const synced = await syncRawFilesToStore([history(1000)], store, fakeHasher, provider);
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    const sourceId = synced.value.events[0]?.sourceId;
    if (!sourceId) return;

    await store.deleteSource(sourceId);
    const afterDelete = await store.loadAll();
    expect(afterDelete.ok).toBe(true);
    if (!afterDelete.ok) return;
    expect(afterDelete.value.events).toHaveLength(1);
    expect(afterDelete.value.documents).toHaveLength(0);

    await store.clearAll();
    const afterClear = await store.loadAll();
    expect(afterClear.ok).toBe(true);
    if (!afterClear.ok) return;
    expect(afterClear.value.events).toHaveLength(0);
  });
  it("rebuilds embeddings only when content changes and updates latest timestamp", async () => {
    const store = new InMemoryStore();
    const provider = new DeterministicEmbeddingProvider("test", 8);
    const first = await syncRawFilesToStore([history(1000)], store, fakeHasher, provider);
    expect(first.ok).toBe(true);
    const changed = { ...history(2000), title: "変更タイトル" };
    const second = await syncRawFilesToStore([changed], store, fakeHasher, provider);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.newEmbeddingsCount).toBeGreaterThan(0);
    const snapshot = await store.loadAll();
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.value.documents[0]?.sourceTimestamp).toBe(2000);
  });

  it("counts an event without a source document as unknown", async () => {
    const { analyzeTopics } = await import("./topic-analyzer.js");
    const store = new InMemoryStore();
    const provider = new DeterministicEmbeddingProvider("test", 8);
    const synced = await syncRawFilesToStore([history(1000)], store, fakeHasher, provider);
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    const result = analyzeTopics(synced.value.entries, [
      { sourceId: "history:missing", eventType: "visited", timestamp: 1000 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.topics.some((topic) => topic.topicId === "unknown")).toBe(true);
    expect(result.value.timeline[0]?.total).toBe(1);
  });
  it("uses the latest timestamped record as the source document title", async () => {
    const store = new InMemoryStore();
    const provider = new DeterministicEmbeddingProvider("test", 8);
    const older = { ...history(1000), title: "古いタイトル" };
    const newer = { ...history(2000), title: "新しいタイトル" };
    await syncRawFilesToStore([newer, older], store, fakeHasher, provider);
    const snapshot = await store.loadAll();
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.value.documents[0]?.title).toBe("新しいタイトル");
  });

  it("returns copies from InMemoryStore.loadAll", async () => {
    const store = new InMemoryStore();
    const provider = new DeterministicEmbeddingProvider("test", 8);
    await syncRawFilesToStore([history(1000)], store, fakeHasher, provider);
    const first = await store.loadAll();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstDocument = first.value.documents[0];
    expect(firstDocument).toBeDefined();
    if (!firstDocument) return;
    firstDocument.title = "変更しても保存されない";
    const second = await store.loadAll();
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.documents[0]?.title).toBe("記事タイトル");
  });
  it("does not roll a document back when an older export is imported", async () => {
    const store = new InMemoryStore();
    const provider = new DeterministicEmbeddingProvider("test", 8);
    await syncRawFilesToStore([{ ...history(2000), title: "新しいタイトル" }], store, fakeHasher, provider);
    await syncRawFilesToStore([{ ...history(1000), title: "古いタイトル" }], store, fakeHasher, provider);
    const snapshot = await store.loadAll();
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.value.documents[0]?.title).toBe("新しいタイトル");
    expect(snapshot.value.documents[0]?.sourceTimestamp).toBe(2000);
  });
});
