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

const history = (timestamp: number, url = "https://Example.com/article?utm_source=x&keep=1#section"): RawFile => ({
  path: url,
  title: "記事タイトル",
  body: "ignored by normalizer",
  updatedAt: timestamp,
  sourceType: "history",
  sourceTimestampKind: "visited",
});

describe("Issue #9 content events", () => {
  it("normalizes tracking parameters while preserving other query and slash details", () => {
    expect(normalizeUrl("https://Example.com/a/?utm_source=x&keep=1#part")).toBe("https://example.com/a/?keep=1");
    expect(normalizeUrl("https://www.example.com/a")).not.toBe(normalizeUrl("https://example.com/a"));
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
});
