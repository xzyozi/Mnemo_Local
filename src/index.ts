import { chunk } from './chunk.js';
import type { SearchEntry } from './domain.js';
import { webCryptoHasher } from './hasher.js';
import { readMarkdownDirectory } from './input-reader.js';
import { normalize } from './normalize.js';
import { SearchIndex } from './search.js';

export * from './chunk.js';
export * from './domain.js';
export * from './hasher.js';
export * from './input-reader.js';
export * from './normalize.js';
export * from './search.js';

const bootstrap = (): void => {
    const chooseButton = document.querySelector<HTMLButtonElement>('#choose-folder');
    const searchInput = document.querySelector<HTMLInputElement>('#search-query');
    const searchButton = document.querySelector<HTMLButtonElement>('#search-button');
    const status = document.querySelector<HTMLElement>('#status');
    const results = document.querySelector<HTMLOListElement>('#results');
    if (!chooseButton || !searchInput || !searchButton || !status || !results) return;

    const index = new SearchIndex();
    chooseButton.addEventListener('click', async () => {
        if (!('showDirectoryPicker' in window)) {
            status.textContent = 'File System Access APIに対応したChromium系ブラウザが必要です。';
            return;
        }
        try {
            const directory = await (window as Window & {
                showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
            }).showDirectoryPicker();
            const batch = await readMarkdownDirectory(directory);
            const normalized = await Promise.all(batch.files.map((file) => normalize(file, webCryptoHasher)));
            const entries: SearchEntry[] = [];
            for (const result of normalized) {
                if (!result.ok) continue;
                const chunks = await chunk(result.value, webCryptoHasher);
                entries.push(...chunks.map((item) => ({ source: result.value, chunk: item })));
            }
            index.clear();
            const added = index.add(entries);
            status.textContent = added.ok
                ? `${entries.length}チャンクを読み込みました。失敗: ${batch.failures.length}件`
                : `読み込みに失敗しました: ${added.error}`;
        } catch {
            status.textContent = 'フォルダを読み込めませんでした。';
        }
    });

    searchButton.addEventListener('click', () => {
        const result = index.search(searchInput.value);
        results.replaceChildren();
        if (!result.ok) {
            status.textContent = `検索エラー: ${result.error}`;
            return;
        }
        result.value.forEach((item) => {
            const element = document.createElement('li');
            element.textContent = `${item.title} (${item.score.toFixed(2)}) — ${item.snippet}`;
            results.append(element);
        });
        status.textContent = `${result.value.length}件見つかりました。`;
    });
};

if (typeof document !== 'undefined') bootstrap();
