import { chunk } from "./chunk.js";
import type { RawFile, SearchEntry } from "./domain.js";
import { DeterministicEmbeddingProvider } from "./embedding.js";
import { webCryptoHasher } from "./hasher.js";
import { readInputFiles, readMarkdownDirectory } from "./input-reader.js";
import { normalize } from "./normalize.js";
import { SearchIndex } from "./search.js";
import { InMemoryStore, IndexedDbStore, type MemoryStore, syncRawFilesToStore } from "./store.js";

export * from "./chunk.js";
export * from "./domain.js";
export * from "./embedding.js";
export * from "./hasher.js";
export * from "./input-reader.js";
export * from "./normalize.js";
export * from "./search.js";
export * from "./store.js";

const bootstrap = async (): Promise<void> => {
  const chooseFolderButton = document.querySelector<HTMLButtonElement>("#choose-folder");
  const chooseFilesInput = document.querySelector<HTMLInputElement>("#choose-files");
  const clearDataButton = document.querySelector<HTMLButtonElement>("#clear-data-button");
  const searchInput = document.querySelector<HTMLInputElement>("#search-query");
  const searchButton = document.querySelector<HTMLButtonElement>("#search-button");
  const status = document.querySelector<HTMLElement>("#status");
  const results = document.querySelector<HTMLOListElement>("#results");

  if (!chooseFolderButton || !searchInput || !searchButton || !status || !results) return;

  const store: MemoryStore =
    typeof indexedDB !== "undefined" ? new IndexedDbStore() : new InMemoryStore();
  const embeddingProvider = new DeterministicEmbeddingProvider();
  let index = new SearchIndex();
  let loading = false;

  // Restore snapshot from store on startup
  try {
    const loaded = await store.loadAll();
    if (loaded.ok && loaded.value.chunks.length > 0) {
      const docMap = new Map(loaded.value.documents.map((d) => [d.sourceId, d]));
      const embedMap = new Map(loaded.value.embeddings.map((e) => [e.chunkId, e]));
      const entries: SearchEntry[] = [];
      for (const ch of loaded.value.chunks) {
        const doc = docMap.get(ch.sourceId);
        if (doc) {
          entries.push({
            chunk: ch,
            source: doc,
            embedding: embedMap.get(ch.chunkId),
          });
        }
      }
      index.add(entries);
      status.textContent = `保存済みデータから ${entries.length} チャンクを復元しました。`;
    } else {
      status.textContent = "フォルダまたはファイルを選択してください。";
    }
  } catch {
    status.textContent = "フォルダまたはファイルを選択してください。";
  }

  const processRawFiles = async (
    rawFiles: RawFile[],
    readFailures: { path: string; message: string }[],
  ) => {
    results.replaceChildren();

    const excluded: string[] = [];
    const validRawFiles: RawFile[] = [];

    for (const file of rawFiles) {
      const normRes = await normalize(file, webCryptoHasher);
      if (!normRes.ok) {
        excluded.push(`${normRes.error}: ${file.path}`);
      } else {
        validRawFiles.push(file);
      }
    }

    const syncRes = await syncRawFilesToStore(
      validRawFiles,
      store,
      webCryptoHasher,
      embeddingProvider,
    );

    if (!syncRes.ok) {
      status.textContent = "データの保存に失敗しました。既存の検索結果を保持しています。";
      return;
    }

    const nextIndex = new SearchIndex();
    const added = nextIndex.add(syncRes.value.entries);
    if (!added.ok) {
      status.textContent =
        added.error === "INDEX_SIZE_LIMIT"
          ? "登録対象を減らして、もう一度選択してください。"
          : "検索インデックスを更新できませんでした。既存の検索結果を保持しています。";
      return;
    }

    index = nextIndex;

    const failureDetails =
      readFailures.length > 0 ? ` 読込失敗詳細: ${readFailures.map((f) => f.path).join("、")}` : "";
    const excludedSummary = excluded.length > 0 ? ` 除外内訳: ${excluded.join("、")}` : "";

    status.textContent =
      `${syncRes.value.chunksCount}チャンク（再利用: ${syncRes.value.reusedChunksCount}件、新規ベクトル: ${syncRes.value.newEmbeddingsCount}件）を読み込みました。` +
      `ファイル読込失敗: ${readFailures.length}件、除外: ${excluded.length}件。${failureDetails}${excludedSummary}`;
  };

  chooseFolderButton.addEventListener("click", async () => {
    if (loading) return;
    loading = true;
    chooseFolderButton.disabled = true;
    status.textContent = "読み込み中です...";
    try {
      if (!("showDirectoryPicker" in window)) {
        status.textContent = "File System Access APIに対応したChromium系ブラウザが必要です。";
        return;
      }
      const directory = await (
        window as Window & {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker();

      const readResult = await readMarkdownDirectory(directory);
      if (!readResult.ok) {
        status.textContent = readResult.error.message;
        return;
      }

      await processRawFiles(readResult.value.files, readResult.value.failures);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        status.textContent = "フォルダ選択をキャンセルしました。";
        return;
      }
      status.textContent = "フォルダを読み込めませんでした。既存の検索結果を保持しています。";
    } finally {
      loading = false;
      chooseFolderButton.disabled = false;
    }
  });

  chooseFilesInput?.addEventListener("change", async () => {
    if (loading || !chooseFilesInput.files || chooseFilesInput.files.length === 0) return;
    loading = true;
    chooseFilesInput.disabled = true;
    status.textContent = "ファイルを読み込み中です...";
    try {
      const batch = await readInputFiles(chooseFilesInput.files);
      await processRawFiles(batch.files, batch.failures);
    } catch {
      status.textContent = "ファイルを読み込めませんでした。";
    } finally {
      loading = false;
      chooseFilesInput.disabled = false;
      chooseFilesInput.value = "";
    }
  });

  clearDataButton?.addEventListener("click", async () => {
    if (loading) return;
    loading = true;
    try {
      await store.clearAll();
      index.clear();
      results.replaceChildren();
      status.textContent = "保存データをクリアしました。";
    } catch {
      status.textContent = "データのクリアに失敗しました。";
    } finally {
      loading = false;
    }
  });

  searchButton.addEventListener("click", async () => {
    const query = searchInput.value;
    if (!query.trim()) {
      status.textContent = "検索語を入力してください。";
      return;
    }

    let queryVector: number[] | undefined;
    const embedRes = await embeddingProvider.embedQuery(query);
    if (embedRes.ok) {
      queryVector = embedRes.value;
    }

    const result = index.search(query, { queryVector });
    results.replaceChildren();
    if (!result.ok) {
      status.textContent = `検索エラー: ${result.error}`;
      return;
    }

    for (const item of result.value) {
      const element = document.createElement("li");
      element.textContent = `${item.title} (${item.score.toFixed(4)}) [${item.sourceLocator}] — ${item.snippet}`;
      results.append(element);
    }
    status.textContent = `${result.value.length}件見つかりました。`;
  });
};

if (typeof document !== "undefined") {
  bootstrap();
}
