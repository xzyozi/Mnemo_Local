import { chunk } from "./chunk.js";
import type {
  EmbeddingCache,
  MemoryChunk,
  RawFile,
  Result,
  SearchEntry,
  SourceDocument,
  StoreError,
} from "./domain.js";
import type { EmbeddingProvider } from "./embedding.js";
import type { Hasher } from "./hasher.js";
import { normalize } from "./normalize.js";

export interface StoredSnapshot {
  documents: SourceDocument[];
  chunks: MemoryChunk[];
  embeddings: EmbeddingCache[];
}

export interface SyncSummary {
  documentsCount: number;
  chunksCount: number;
  reusedChunksCount: number;
  newEmbeddingsCount: number;
  entries: SearchEntry[];
}

export interface MemoryStore {
  loadAll(): Promise<Result<StoredSnapshot, StoreError>>;
  saveBatch(snapshot: StoredSnapshot): Promise<Result<void, StoreError>>;
  deleteSource(sourceId: string): Promise<Result<void, StoreError>>;
  clearAll(): Promise<Result<void, StoreError>>;
}

export class InMemoryStore implements MemoryStore {
  private documents = new Map<string, SourceDocument>();
  private chunks = new Map<string, MemoryChunk>();
  private embeddings = new Map<string, EmbeddingCache>();

  async loadAll(): Promise<Result<StoredSnapshot, StoreError>> {
    return {
      ok: true,
      value: {
        documents: Array.from(this.documents.values()),
        chunks: Array.from(this.chunks.values()),
        embeddings: Array.from(this.embeddings.values()),
      },
    };
  }

  async saveBatch(snapshot: StoredSnapshot): Promise<Result<void, StoreError>> {
    for (const doc of snapshot.documents) {
      this.documents.set(doc.sourceId, doc);
    }
    for (const ch of snapshot.chunks) {
      this.chunks.set(ch.chunkId, ch);
    }
    for (const em of snapshot.embeddings) {
      this.embeddings.set(em.chunkId, em);
    }
    return { ok: true, value: undefined };
  }

  async deleteSource(sourceId: string): Promise<Result<void, StoreError>> {
    this.documents.delete(sourceId);
    for (const [chunkId, ch] of this.chunks.entries()) {
      if (ch.sourceId === sourceId) {
        this.chunks.delete(chunkId);
        this.embeddings.delete(chunkId);
      }
    }
    return { ok: true, value: undefined };
  }

  async clearAll(): Promise<Result<void, StoreError>> {
    this.documents.clear();
    this.chunks.clear();
    this.embeddings.clear();
    return { ok: true, value: undefined };
  }
}

const DB_NAME = "local-semantic-memory";
const DB_VERSION = 1;

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
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("sourceDocuments")) {
          db.createObjectStore("sourceDocuments", { keyPath: "sourceId" });
        }
        if (!db.objectStoreNames.contains("chunks")) {
          db.createObjectStore("chunks", { keyPath: "chunkId" });
        }
        if (!db.objectStoreNames.contains("embeddings")) {
          db.createObjectStore("embeddings", { keyPath: "chunkId" });
        }
      };
    });
  }

  async loadAll(): Promise<Result<StoredSnapshot, StoreError>> {
    try {
      const db = await this.openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(["sourceDocuments", "chunks", "embeddings"], "readonly");
        const docReq = tx.objectStore("sourceDocuments").getAll();
        const chunkReq = tx.objectStore("chunks").getAll();
        const embedReq = tx.objectStore("embeddings").getAll();

        tx.onerror = () => resolve({ ok: false, error: "STORE_READ_FAILED" });
        tx.oncomplete = () => {
          resolve({
            ok: true,
            value: {
              documents: (docReq.result as SourceDocument[]) || [],
              chunks: (chunkReq.result as MemoryChunk[]) || [],
              embeddings: (embedReq.result as EmbeddingCache[]) || [],
            },
          });
        };
      });
    } catch {
      return { ok: false, error: "STORE_READ_FAILED" };
    }
  }

  async saveBatch(snapshot: StoredSnapshot): Promise<Result<void, StoreError>> {
    try {
      const db = await this.openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(["sourceDocuments", "chunks", "embeddings"], "readwrite");
        tx.onerror = () => resolve({ ok: false, error: "STORE_WRITE_FAILED" });
        tx.oncomplete = () => resolve({ ok: true, value: undefined });

        const docStore = tx.objectStore("sourceDocuments");
        for (const doc of snapshot.documents) docStore.put(doc);

        const chunkStore = tx.objectStore("chunks");
        for (const ch of snapshot.chunks) chunkStore.put(ch);

        const embedStore = tx.objectStore("embeddings");
        for (const em of snapshot.embeddings) embedStore.put(em);
      });
    } catch {
      return { ok: false, error: "STORE_WRITE_FAILED" };
    }
  }

  async deleteSource(sourceId: string): Promise<Result<void, StoreError>> {
    try {
      const db = await this.openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(["sourceDocuments", "chunks", "embeddings"], "readwrite");
        tx.onerror = () => resolve({ ok: false, error: "STORE_WRITE_FAILED" });
        tx.oncomplete = () => resolve({ ok: true, value: undefined });

        tx.objectStore("sourceDocuments").delete(sourceId);

        const chunkStore = tx.objectStore("chunks");
        const embedStore = tx.objectStore("embeddings");
        const req = chunkStore.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const ch = cursor.value as MemoryChunk;
            if (ch.sourceId === sourceId) {
              cursor.delete();
              embedStore.delete(ch.chunkId);
            }
            cursor.continue();
          }
        };
      });
    } catch {
      return { ok: false, error: "STORE_WRITE_FAILED" };
    }
  }

  async clearAll(): Promise<Result<void, StoreError>> {
    try {
      const db = await this.openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(["sourceDocuments", "chunks", "embeddings"], "readwrite");
        tx.onerror = () => resolve({ ok: false, error: "STORE_CLEAR_FAILED" });
        tx.oncomplete = () => resolve({ ok: true, value: undefined });

        tx.objectStore("sourceDocuments").clear();
        tx.objectStore("chunks").clear();
        tx.objectStore("embeddings").clear();
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
  const loadRes = await store.loadAll();
  if (!loadRes.ok) return loadRes;

  const existing = loadRes.value;
  const docMap = new Map(existing.documents.map((d) => [d.sourceId, d]));
  const chunkMap = new Map(existing.chunks.map((c) => [c.chunkId, c]));
  const embedMap = new Map(existing.embeddings.map((e) => [e.chunkId, e]));

  const documentsToSave: SourceDocument[] = [];
  const chunksToSave: MemoryChunk[] = [];
  const embeddingsToSave: EmbeddingCache[] = [];

  let reusedChunksCount = 0;
  let newEmbeddingsCount = 0;

  for (const raw of rawFiles) {
    const normRes = await normalize(raw, hasher);
    if (!normRes.ok) continue;

    const doc = normRes.value;
    documentsToSave.push(doc);

    const prevDoc = docMap.get(doc.sourceId);
    let docChunks: MemoryChunk[];

    if (prevDoc && prevDoc.sourceHash === doc.sourceHash) {
      // Re-use chunks
      docChunks = existing.chunks.filter((c) => c.sourceId === doc.sourceId);
    } else {
      docChunks = await chunk(doc, hasher);
    }

    chunksToSave.push(...docChunks);

    for (const ch of docChunks) {
      const prevEmbed = embedMap.get(ch.chunkId);
      const prevChunk = chunkMap.get(ch.chunkId);

      if (
        prevEmbed &&
        prevChunk &&
        prevChunk.contentHash === ch.contentHash &&
        prevEmbed.modelId === embeddingProvider.modelId
      ) {
        embeddingsToSave.push(prevEmbed);
        reusedChunksCount++;
      } else {
        const embedRes = await embeddingProvider.embedPassage(ch.body);
        if (embedRes.ok) {
          const newEmbed: EmbeddingCache = {
            chunkId: ch.chunkId,
            modelId: embeddingProvider.modelId,
            dimensions: embeddingProvider.dimensions,
            vector: embedRes.value,
            generatedAt: new Date().toISOString(),
          };
          embeddingsToSave.push(newEmbed);
          newEmbeddingsCount++;
        }
      }
    }
  }

  const saveRes = await store.saveBatch({
    documents: documentsToSave,
    chunks: chunksToSave,
    embeddings: embeddingsToSave,
  });
  if (!saveRes.ok) return saveRes;

  // Build current entries from all saved + existing data
  const finalDocMap = new Map(documentsToSave.map((d) => [d.sourceId, d]));
  const finalEmbedMap = new Map(embeddingsToSave.map((e) => [e.chunkId, e]));

  const entries: SearchEntry[] = [];
  for (const ch of chunksToSave) {
    const d = finalDocMap.get(ch.sourceId);
    if (!d) continue;
    entries.push({
      chunk: ch,
      source: d,
      embedding: finalEmbedMap.get(ch.chunkId),
    });
  }

  return {
    ok: true,
    value: {
      documentsCount: documentsToSave.length,
      chunksCount: chunksToSave.length,
      reusedChunksCount,
      newEmbeddingsCount,
      entries,
    },
  };
};
