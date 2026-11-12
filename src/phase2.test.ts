import { describe, expect, it } from "vitest";
import type { Hasher, RawFile } from "./domain.js";
import { DeterministicEmbeddingProvider } from "./embedding.js";
import { parseStructuredExport } from "./input-reader.js";
import { normalize } from "./normalize.js";
import { SearchIndex } from "./search.js";
import { InMemoryStore, syncRawFilesToStore } from "./store.js";

const fakeHasher: Hasher = {
  async digest(value: string) {
    return `hash:${value}`;
  },
};

describe("Phase 2 domain and features", () => {
  describe("Normalizer - History and Bookmarks", () => {
    it("accepts valid http and https URLs", async () => {
      const historyRaw: RawFile = {
        path: "https://example.com/page1",
        title: "Example Page",
        body: "Contents of page 1",
        updatedAt: 1700000000000,
        sourceType: "history",
      };
      const res = await normalize(historyRaw, fakeHasher);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.sourceId).toBe("history:https://example.com/page1:1700000000000");
        expect(res.value.sourceType).toBe("history");
        expect(res.value.sourceTimestampKind).toBe("visited");
        expect(res.value.title).toBe("Example Page");
      }

      const bookmarkRaw: RawFile = {
        path: "http://example.org/about",
        title: "",
        body: "About us",
        updatedAt: 1700000005000,
        sourceType: "bookmark",
      };
      const bmRes = await normalize(bookmarkRaw, fakeHasher);
      expect(bmRes.ok).toBe(true);
      if (bmRes.ok) {
        expect(bmRes.value.sourceId).toBe("bookmark:http://example.org/about");
        expect(bmRes.value.sourceType).toBe("bookmark");
        expect(bmRes.value.sourceTimestampKind).toBe("created");
        expect(bmRes.value.title).toBe("about");
      }
    });

    it("rejects non-http/https URL schemes with URL_EXCLUDED", async () => {
      const invalidSchemes = [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,hello",
        "chrome://settings",
        "about:blank",
        "not a valid url",
      ];

      for (const path of invalidSchemes) {
        const raw: RawFile = {
          path,
          title: "Test",
          body: "Content",
          updatedAt: 1,
          sourceType: "history",
        };
        const res = await normalize(raw, fakeHasher);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBe("URL_EXCLUDED");
        }
      }
    });

    it("rejects empty body with DOCUMENT_EMPTY", async () => {
      const raw: RawFile = {
        path: "https://example.com/empty",
        title: "Empty",
        body: "   ",
        updatedAt: 1,
        sourceType: "bookmark",
      };
      const res = await normalize(raw, fakeHasher);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("DOCUMENT_EMPTY");
      }
    });
  });

  describe("InputReader - Structured exports", () => {
    it("parses JSON export of history and bookmarks", () => {
      const jsonContent = JSON.stringify([
        { url: "https://site.com/a", title: "Site A", text: "Summary A", time: 1700000010000 },
        { url: "https://site.com/b", title: "Site B", body: "Summary B", time: 1700000020000 },
      ]);
      const res = parseStructuredExport("history.json", jsonContent);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toHaveLength(2);
        expect(res.value[0]?.path).toBe("https://site.com/a");
        expect(res.value[0]?.sourceType).toBe("history");
        expect(res.value[1]?.path).toBe("https://site.com/b");
      }
    });

    it("parses HTML Netscape bookmarks export", () => {
      const htmlContent = `
        <!DOCTYPE NETSCAPE-Bookmark-file-1>
        <TITLE>Bookmarks</TITLE>
        <H1>Bookmarks</H1>
        <DL><p>
          <DT><A HREF="https://bookmark.org/item1" ADD_DATE="1700000000">Item 1</A>
          <DT><A HREF="https://bookmark.org/item2" ADD_DATE="1700000050">Item 2</A>
        </DL><p>
      `;
      const res = parseStructuredExport("bookmarks.html", htmlContent);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toHaveLength(2);
        expect(res.value[0]?.path).toBe("https://bookmark.org/item1");
        expect(res.value[0]?.title).toBe("Item 1");
        expect(res.value[0]?.updatedAt).toBe(1700000000000);
      }
    });
  });

  describe("EmbeddingProvider", () => {
    const provider = new DeterministicEmbeddingProvider("test-model", 384);

    it("generates 384-dimensional normalized vectors", async () => {
      const passageRes = await provider.embedPassage("サンプル文書");
      expect(passageRes.ok).toBe(true);
      if (passageRes.ok) {
        expect(passageRes.value).toHaveLength(384);
        let normSq = 0;
        for (const v of passageRes.value) normSq += v * v;
        expect(Math.abs(Math.sqrt(normSq) - 1)).toBeLessThan(1e-4);
      }

      const queryRes = await provider.embedQuery("検索クエリ");
      expect(queryRes.ok).toBe(true);
      if (queryRes.ok) {
        expect(queryRes.value).toHaveLength(384);
      }
    });

    it("returns EMBEDDING_EMPTY for empty string", async () => {
      const res = await provider.embedPassage("   ");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("EMBEDDING_EMPTY");
      }
    });
  });

  describe("MemoryStore and Differential Synchronization", () => {
    it("stores documents and skips recalculation when contentHash matches", async () => {
      const store = new InMemoryStore();
      const provider = new DeterministicEmbeddingProvider("test-model", 384);

      const file1: RawFile = {
        path: "doc1.md",
        title: "Doc 1",
        body: "# セクション1\n文書の内容その1",
        updatedAt: 1000,
      };
      const file2: RawFile = {
        path: "https://news.com/tech",
        title: "Tech News",
        body: "AI updates and announcements",
        updatedAt: 2000,
        sourceType: "history",
      };

      // 1. Initial sync
      const sync1 = await syncRawFilesToStore([file1, file2], store, fakeHasher, provider);
      expect(sync1.ok).toBe(true);
      if (sync1.ok) {
        expect(sync1.value.documentsCount).toBe(2);
        expect(sync1.value.reusedChunksCount).toBe(0);
        expect(sync1.value.newEmbeddingsCount).toBeGreaterThan(0);
      }

      // 2. Second sync with identical content -> should reuse all embeddings
      const sync2 = await syncRawFilesToStore([file1, file2], store, fakeHasher, provider);
      expect(sync2.ok).toBe(true);
      if (sync2.ok) {
        expect(sync2.value.documentsCount).toBe(2);
        expect(sync2.value.reusedChunksCount).toBe(sync2.value.chunksCount);
        expect(sync2.value.newEmbeddingsCount).toBe(0);
      }

      // 3. Clear store
      const clearRes = await store.clearAll();
      expect(clearRes.ok).toBe(true);
      const snapshotAfterClear = await store.loadAll();
      expect(snapshotAfterClear.ok).toBe(true);
      if (snapshotAfterClear.ok) {
        expect(snapshotAfterClear.value.documents).toHaveLength(0);
        expect(snapshotAfterClear.value.chunks).toHaveLength(0);
      }
    });
  });

  describe("SearchIndex - RRF Hybrid Search and Filters", () => {
    it("combines keyword and vector rankings via RRF", async () => {
      const store = new InMemoryStore();
      const provider = new DeterministicEmbeddingProvider("test-model", 384);

      const files: RawFile[] = [
        {
          path: "fileA.md",
          title: "検索エンジンの設計",
          body: "全文検索とベクトル検索のハイブリッド統合を行う設計",
          updatedAt: 1000,
        },
        {
          path: "fileB.md",
          title: "料理レシピ",
          body: "美味しいカレーの作り方とスパイスの選定",
          updatedAt: 2000,
        },
      ];

      const syncRes = await syncRawFilesToStore(files, store, fakeHasher, provider);
      expect(syncRes.ok).toBe(true);
      if (!syncRes.ok) return;

      const index = new SearchIndex();
      index.add(syncRes.value.entries);

      // Search with query vector
      const embedQueryRes = await provider.embedQuery("検索エンジン");
      expect(embedQueryRes.ok).toBe(true);
      if (!embedQueryRes.ok) return;

      const searchRes = index.search("検索エンジン", {
        queryVector: embedQueryRes.value,
        rrfK: 60,
      });

      expect(searchRes.ok).toBe(true);
      if (searchRes.ok) {
        expect(searchRes.value.length).toBeGreaterThanOrEqual(1);
        const topResult = searchRes.value[0];
        expect(topResult?.title).toBe("検索エンジンの設計");
        // RRF score should be greater than 0
        expect(topResult?.score).toBeGreaterThan(0);
      }
    });

    it("filters results by sourceType", async () => {
      const store = new InMemoryStore();
      const provider = new DeterministicEmbeddingProvider("test-model", 384);

      const files: RawFile[] = [
        {
          path: "notes/memo.md",
          title: "TypeScriptメモ",
          body: "TypeScriptの設計パターンと型安全性",
          updatedAt: 1000,
          sourceType: "markdown",
        },
        {
          path: "https://ts.dev/tips",
          title: "TypeScript Tips",
          body: "TypeScriptの最新機能解説",
          updatedAt: 2000,
          sourceType: "bookmark",
        },
      ];

      const syncRes = await syncRawFilesToStore(files, store, fakeHasher, provider);
      expect(syncRes.ok).toBe(true);
      if (!syncRes.ok) return;

      const index = new SearchIndex();
      index.add(syncRes.value.entries);

      const bookmarkOnly = index.search("TypeScript", { sourceTypes: ["bookmark"] });
      expect(bookmarkOnly.ok).toBe(true);
      if (bookmarkOnly.ok) {
        expect(bookmarkOnly.value).toHaveLength(1);
        expect(bookmarkOnly.value[0]?.sourceLocator).toBe("https://ts.dev/tips");
      }

      const markdownOnly = index.search("TypeScript", { sourceTypes: ["markdown"] });
      expect(markdownOnly.ok).toBe(true);
      if (markdownOnly.ok) {
        expect(markdownOnly.value).toHaveLength(1);
        expect(markdownOnly.value[0]?.sourceLocator).toBe("notes/memo.md");
      }
    });
  });
});
