import { chunk } from "./chunk.js";
import type {
  RawFile,
  SearchEntry,
  SourceEvent,
  StoredSnapshot,
  TopicAnalysisResult,
} from "./domain.js";
import { DeterministicEmbeddingProvider } from "./embedding.js";
import { renderTopicTimelineSvg } from "./graph-renderer.js";
import { webCryptoHasher } from "./hasher.js";
import { readInputFiles, readMarkdownDirectory } from "./input-reader.js";
import { normalize } from "./normalize.js";
import { SearchIndex } from "./search.js";
import { InMemoryStore, IndexedDbStore, type MemoryStore, syncRawFilesToStore } from "./store.js";
import { analyzeTopics } from "./topic-analyzer.js";

export * from "./chunk.js";
export * from "./domain.js";
export * from "./embedding.js";
export * from "./graph-renderer.js";
export * from "./hasher.js";
export * from "./input-reader.js";
export * from "./normalize.js";
export * from "./search.js";
export * from "./store.js";
export * from "./topic-analyzer.js";

const bootstrap = async (): Promise<void> => {
  const chooseFolderButton = document.querySelector<HTMLButtonElement>("#choose-folder");
  const chooseFilesInput = document.querySelector<HTMLInputElement>("#choose-files");
  const clearDataButton = document.querySelector<HTMLButtonElement>("#clear-data-button");
  const searchInput = document.querySelector<HTMLInputElement>("#search-query");
  const searchButton = document.querySelector<HTMLButtonElement>("#search-button");
  const status = document.querySelector<HTMLElement>("#status");
  const results = document.querySelector<HTMLOListElement>("#results");
  const timelineContainer = document.querySelector<HTMLElement>("#timeline-container");
  const topicFilterStatus = document.querySelector<HTMLElement>("#topic-filter-status");
  const selectedTopicLabel = document.querySelector<HTMLElement>("#selected-topic-label");
  const resetTopicButton = document.querySelector<HTMLButtonElement>("#reset-topic-button");

  if (!chooseFolderButton || !searchInput || !searchButton || !status || !results) return;

  const store: MemoryStore =
    typeof indexedDB !== "undefined" ? new IndexedDbStore() : new InMemoryStore();
  const embeddingProvider = new DeterministicEmbeddingProvider();
  let index = new SearchIndex();
  let loading = false;
  let selectedTopicId: string | null = null;
  let latestAnalysis: TopicAnalysisResult | null = null;

  const executeSearch = async (): Promise<void> => {
    const query = searchInput.value;
    if (!query.trim() && !selectedTopicId) {
      status.textContent = "検索語を入力してください。";
      return;
    }

    let queryVector: number[] | undefined;
    if (query.trim()) {
      const embedRes = await embeddingProvider.embedQuery(query);
      if (embedRes.ok) {
        queryVector = embedRes.value;
      }
    }

    const result = index.search(query, {
      queryVector,
      topicId: selectedTopicId ?? undefined,
    });
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

    const filterNote = selectedTopicId
      ? `（トピック「${latestAnalysis?.topics.find((t) => t.topicId === selectedTopicId)?.label ?? selectedTopicId}」で絞り込み中）`
      : "";
    status.textContent = `${result.value.length}件見つかりました。${filterNote}`;
  };

  const handleSelectTopic = (topicId: string | null): void => {
    selectedTopicId = topicId;
    if (topicFilterStatus && selectedTopicLabel) {
      if (topicId) {
        const found = latestAnalysis?.topics.find((t) => t.topicId === topicId);
        selectedTopicLabel.textContent = `選択トピック: ${found ? found.label : topicId}`;
        topicFilterStatus.style.display = "block";
      } else {
        topicFilterStatus.style.display = "none";
      }
    }
    executeSearch();
  };

  const entriesFromSnapshot = (snapshot: StoredSnapshot): SearchEntry[] => {
    const documents = new Map(snapshot.documents.map((document) => [document.sourceId, document]));
    const embeddings = new Map(
      snapshot.embeddings.map((embedding) => [embedding.chunkId, embedding]),
    );
    return snapshot.chunks.flatMap((chunk) => {
      const source = documents.get(chunk.sourceId);
      if (!source) return [];
      return [{ chunk, source, embedding: embeddings.get(chunk.chunkId) }];
    });
  };

  const refreshTimeline = (entries: SearchEntry[], events: SourceEvent[]): void => {
    if (!timelineContainer) return;
    const analysisRes = analyzeTopics(entries, events);
    if (analysisRes.ok) {
      latestAnalysis = analysisRes.value;
      index.setTopicAssignments(analysisRes.value.assignments);
      const svg = renderTopicTimelineSvg(
        analysisRes.value.timeline,
        analysisRes.value.topics,
        handleSelectTopic,
      );
      timelineContainer.replaceChildren(svg);
    } else {
      latestAnalysis = null;
      timelineContainer.replaceChildren();
    }
  };

  resetTopicButton?.addEventListener("click", () => {
    handleSelectTopic(null);
  });

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
      refreshTimeline(entries, loaded.value.events);
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

    const refreshed = await store.loadAll();
    if (!refreshed.ok) {
      status.textContent =
        "保存済みデータの再読み込みに失敗しました。既存の検索結果を保持しています。";
      return;
    }
    const allEntries = entriesFromSnapshot(refreshed.value);
    const allIndex = new SearchIndex();
    const allAdded = allIndex.add(allEntries);
    if (!allAdded.ok) {
      status.textContent = "保存済みデータが上限を超えています。登録対象を減らしてください。";
      return;
    }
    index = allIndex;
    refreshTimeline(allEntries, refreshed.value.events);

    const failureDetails =
      readFailures.length > 0 ? ` 読込失敗詳細: ${readFailures.map((f) => f.path).join("、")}` : "";
    const excludedSummary = excluded.length > 0 ? ` 除外内訳: ${excluded.join("、")}` : "";

    status.textContent =
      `${syncRes.value.chunksCount}チャンク（再利用: ${syncRes.value.reusedChunksCount}件、新規ベクトル: ${syncRes.value.newEmbeddingsCount}件）を読み込みました。` +
      `events: ${syncRes.value.eventsCount}件、ファイル読込失敗: ${readFailures.length}件、除外: ${excluded.length}件。${failureDetails}${excludedSummary}`;
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
      latestAnalysis = null;
      selectedTopicId = null;
      if (topicFilterStatus) topicFilterStatus.style.display = "none";
      timelineContainer?.replaceChildren();
      results.replaceChildren();
      status.textContent = "保存データをクリアしました。";
    } catch {
      status.textContent = "データのクリアに失敗しました。";
    } finally {
      loading = false;
    }
  });

  searchButton.addEventListener("click", async () => {
    await executeSearch();
  });
};

if (typeof document !== "undefined") {
  bootstrap();
}
