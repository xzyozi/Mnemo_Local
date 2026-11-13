import { chunk } from "./chunk.js";
import type {
  EmbeddingCache,
  MemoryChunk,
  RawFile,
  Result,
  SearchEntry,
  SourceDocument,
  SourceEvent,
  StoreError,
  StoredSnapshot,
} from "./domain.js";
import type { EmbeddingProvider } from "./embedding.js";
import type { Hasher } from "./hasher.js";
import { normalize } from "./normalize.js";

export interface SyncSummary {
  documentsCount: number;
  chunksCount: number;
  reusedChunksCount: number;
  newEmbeddingsCount: number;
  eventsCount: number;
  entries: SearchEntry[];
  events: SourceEvent[];
}

export interface MemoryStore {
  loadAll(): Promise<Result<StoredSnapshot, StoreError>>;
  saveBatch(snapshot: StoredSnapshot): Promise<Result<void, StoreError>>;
  deleteSource(sourceId: string): Promise<Result<void, StoreError>>;
  clearAll(): Promise<Result<void, StoreError>>;
}

const eventKey = (event: SourceEvent): string =>
  `${event.sourceId}|${event.eventType}|${event.timestamp}`;

const emptySnapshot = (): StoredSnapshot => ({
  documents: [],
  chunks: [],
  embeddings: [],
  events: [],
});

export class InMemoryStore implements MemoryStore {
  private snapshot = emptySnapshot();

  async loadAll(): Promise<Result<StoredSnapshot, StoreError>> {
    return {
      ok: true,
      value: {
        documents: this.snapshot.documents.map((item) => ({ ...item })),
        chunks: this.snapshot.chunks.map((item) => ({ ...item })),
        embeddings: this.snapshot.embeddings.map((item) => ({ ...item, vector: [...item.vector] })),
        events: this.snapshot.events.map((item) => ({ ...item })),
      },
    };
  }

  async saveBatch(snapshot: StoredSnapshot): Promise<Result<void, StoreError>> {
    const documents = new Map(this.snapshot.documents.map((item) => [item.sourceId, item]));
    const chunks = new Map(this.snapshot.chunks.map((item) => [item.chunkId, item]));
    const embeddings = new Map(this.snapshot.embeddings.map((item) => [item.chunkId, item]));
    const events = new Map(
      this.snapshot.events.map((item) => [
        eventKey(item),
        item,
      ]),
    );
    for (const item of snapshot.documents) documents.set(item.sourceId, item);
    for (const item of snapshot.chunks) chunks.set(item.chunkId, item);
    for (const item of snapshot.embeddings) embeddings.set(item.chunkId, item);
    for (const item of snapshot.events)
      events.set(eventKey(item), item);
    this.snapshot = {
      documents: [...documents.values()],
      chunks: [...chunks.values()],
      embeddings: [...embeddings.values()],
      events: [...events.values()],
    };
    return { ok: true, value: undefined };
  }

  async deleteSource(sourceId: string): Promise<Result<void, StoreError>> {
    this.snapshot.documents = this.snapshot.documents.filter((item) => item.sourceId !== sourceId);
    const chunkIds = new Set(
      this.snapshot.chunks.filter((item) => item.sourceId === sourceId).map((item) => item.chunkId),
    );
    this.snapshot.chunks = this.snapshot.chunks.filter((item) => item.sourceId !== sourceId);
    this.snapshot.embeddings = this.snapshot.embeddings.filter(
      (item) => !chunkIds.has(item.chunkId),
    );
    return { ok: true, value: undefined };
  }

  async clearAll(): Promise<Result<void, StoreError>> {
    this.snapshot = emptySnapshot();
    return { ok: true, value: undefined };
  }
}

const DB_NAME = "local-semantic-memory";
const DB_VERSION = 2;
const STORE_NAMES = ["sourceDocuments", "chunks", "embeddings", "events"] as const;

export class IndexedDbStore implements MemoryStore {
  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not supported"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const transaction = request.transaction;
        if (!transaction) return;
        if (!db.objectStoreNames.contains("sourceDocuments"))
          db.createObjectStore("sourceDocuments", { keyPath: "sourceId" });
        if (!db.objectStoreNames.contains("chunks"))
          db.createObjectStore("chunks", { keyPath: "chunkId" });
        if (!db.objectStoreNames.contains("embeddings"))
          db.createObjectStore("embeddings", { keyPath: "chunkId" });
        if (!db.objectStoreNames.contains("events"))
          db.createObjectStore("events", { keyPath: ["sourceId", "eventType", "timestamp"] });
        if (event.oldVersion < 2) {
          const historyIds = new Set<string>();
          const docCursor = transaction.objectStore("sourceDocuments").openCursor();
          docCursor.onsuccess = () => {
            const cursor = docCursor.result;
            if (!cursor) {
              const chunkCursor = transaction.objectStore("chunks").openCursor();
              chunkCursor.onsuccess = () => {
                const chunk = chunkCursor.result;
                if (!chunk) return;
                if (historyIds.has((chunk.value as { sourceId: string }).sourceId)) {
                  transaction
                    .objectStore("embeddings")
                    .delete((chunk.value as { chunkId: string }).chunkId);
                  chunk.delete();
                }
                chunk.continue();
              };
              return;
            }
            const document = cursor.value as SourceDocument;
            if (document.sourceType === "history") {
              historyIds.add(document.sourceId);
              cursor.delete();
            }
            cursor.continue();
          };
        }
      };
    });
  }

  async loadAll(): Promise<Result<StoredSnapshot, StoreError>> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction([...STORE_NAMES], "readonly");
        const requests = STORE_NAMES.map((name) => tx.objectStore(name).getAll());
        tx.onerror = () => resolve({ ok: false, error: "STORE_READ_FAILED" });
        tx.oncomplete = () =>
          resolve({
            ok: true,
            value: {
              documents: (requests[0]?.result as SourceDocument[]) ?? [],
              chunks: (requests[1]?.result as MemoryChunk[]) ?? [],
              embeddings: (requests[2]?.result as EmbeddingCache[]) ?? [],
              events: (requests[3]?.result as SourceEvent[]) ?? [],
            },
          });
      });
    } catch {
      return { ok: false, error: "STORE_READ_FAILED" };
    }
  }

  async saveBatch(snapshot: StoredSnapshot): Promise<Result<void, StoreError>> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction([...STORE_NAMES], "readwrite");
        tx.onerror = () => resolve({ ok: false, error: "STORE_WRITE_FAILED" });
        tx.oncomplete = () => resolve({ ok: true, value: undefined });
        for (const item of snapshot.documents) tx.objectStore("sourceDocuments").put(item);
        for (const item of snapshot.chunks) tx.objectStore("chunks").put(item);
        for (const item of snapshot.embeddings) tx.objectStore("embeddings").put(item);
        for (const item of snapshot.events) tx.objectStore("events").put(item);
      });
    } catch {
      return { ok: false, error: "STORE_WRITE_FAILED" };
    }
  }

  async deleteSource(sourceId: string): Promise<Result<void, StoreError>> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(["sourceDocuments", "chunks", "embeddings"], "readwrite");
        tx.onerror = () => resolve({ ok: false, error: "STORE_WRITE_FAILED" });
        tx.oncomplete = () => resolve({ ok: true, value: undefined });
        tx.objectStore("sourceDocuments").delete(sourceId);
        const chunkStore = tx.objectStore("chunks");
        const embeddingStore = tx.objectStore("embeddings");
        const request = chunkStore.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const chunk = cursor.value as MemoryChunk;
          if (chunk.sourceId === sourceId) {
            embeddingStore.delete(chunk.chunkId);
            cursor.delete();
          }
          cursor.continue();
        };
      });
    } catch {
      return { ok: false, error: "STORE_WRITE_FAILED" };
    }
  }

  async clearAll(): Promise<Result<void, StoreError>> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction([...STORE_NAMES], "readwrite");
        tx.onerror = () => resolve({ ok: false, error: "STORE_CLEAR_FAILED" });
        tx.oncomplete = () => resolve({ ok: true, value: undefined });
        for (const name of STORE_NAMES) tx.objectStore(name).clear();
      });
    } catch {
      return { ok: false, error: "STORE_CLEAR_FAILED" };
    }
  }
}

export const syncRawFilesToStore = async (
  rawFiles: RawFile[],
  store: MemoryStore,
  hasher: Hasher,
  embeddingProvider: EmbeddingProvider,
): Promise<Result<SyncSummary, StoreError>> => {
  const loaded = await store.loadAll();
  if (!loaded.ok) return loaded;
  const existing = loaded.value;
  const documentMap = new Map(existing.documents.map((item) => [item.sourceId, item]));
  const chunkMap = new Map(existing.chunks.map((item) => [item.chunkId, item]));
  const embeddingMap = new Map(existing.embeddings.map((item) => [item.chunkId, item]));
  const eventMap = new Map(
    existing.events.map((item) => [eventKey(item), item]),
  );
  const rawDocuments = new Map<string, SourceDocument>();

  for (const raw of rawFiles) {
    const normalized = await normalize(raw, hasher);
    if (!normalized.ok) continue;
    const current = rawDocuments.get(normalized.value.sourceId);
    if (!current || normalized.value.sourceTimestamp >= current.sourceTimestamp) {
      rawDocuments.set(normalized.value.sourceId, normalized.value);
    }
    const event: SourceEvent = {
      sourceId: normalized.value.sourceId,
      eventType: normalized.value.sourceTimestampKind,
      timestamp: normalized.value.sourceTimestamp,
      ...(normalized.value.sourceType === "markdown" ? {} : { originalLocator: raw.path }),
    };
    eventMap.set(eventKey(event), event);
  }

  const latestEventBySource = new Map<string, SourceEvent>();
  for (const event of eventMap.values()) {
    const current = latestEventBySource.get(event.sourceId);
    if (!current || event.timestamp > current.timestamp)
      latestEventBySource.set(event.sourceId, event);
  }

  const documentsToSave: SourceDocument[] = [];
  const chunksToSave: MemoryChunk[] = [];
  const embeddingsToSave: EmbeddingCache[] = [];
  let reusedChunksCount = 0;
  let newEmbeddingsCount = 0;

  for (const [sourceId, candidate] of rawDocuments) {
    const previous = documentMap.get(sourceId);
    const latestDocument = latest
      ? { ...candidate, sourceTimestamp: latest.timestamp, sourceTimestampKind: latest.eventType }
      : candidate;
    const document = previous && previous.sourceTimestamp > latestDocument.sourceTimestamp
      ? previous
      : latestDocument;
    documentsToSave.push(document);
    let chunks: MemoryChunk[];
    if (previous?.sourceHash === document.sourceHash) {
      chunks = existing.chunks.filter((item) => item.sourceId === sourceId);
      reusedChunksCount += chunks.length;
    } else {
      chunks = await chunk(document, hasher);
    }
    chunksToSave.push(...chunks);
    for (const item of chunks) {
      const previousChunk = chunkMap.get(item.chunkId);
      const previousEmbedding = embeddingMap.get(item.chunkId);
      if (
        previousChunk?.contentHash === item.contentHash &&
        previousEmbedding?.modelId === embeddingProvider.modelId
      ) {
        embeddingsToSave.push(previousEmbedding);
        continue;
      }
      const embedded = await embeddingProvider.embedPassage(item.body);
      if (embedded.ok) {
        embeddingsToSave.push({
          chunkId: item.chunkId,
          modelId: embeddingProvider.modelId,
          dimensions: embeddingProvider.dimensions,
          vector: embedded.value,
          generatedAt: new Date().toISOString(),
        });
        newEmbeddingsCount += 1;
      }
    }
  }

  const saved = await store.saveBatch({
    documents: documentsToSave,
    chunks: chunksToSave,
    embeddings: embeddingsToSave,
    events: [...eventMap.values()],
  });
  if (!saved.ok) return saved;
  const entries = chunksToSave.flatMap((chunkItem) => {
    const source = documentsToSave.find((item) => item.sourceId === chunkItem.sourceId);
    if (!source) return [];
    return [
      {
        chunk: chunkItem,
        source,
        embedding: embeddingsToSave.find((item) => item.chunkId === chunkItem.chunkId),
      },
    ];
  });
  return {
    ok: true,
    value: {
      documentsCount: documentsToSave.length,
      chunksCount: chunksToSave.length,
      reusedChunksCount,
      newEmbeddingsCount,
      eventsCount: eventMap.size,
      entries,
      events: [...eventMap.values()],
    },
  };
};
