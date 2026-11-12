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

    let index = new SearchIndex();
    chooseButton.addEventListener('click', async () => {
        if (!('showDirectoryPicker' in window)) {
            status.textContent = 'File System Access APIに対応したChromium系ブラウザが必要です。';
            return;
        }
        try {
            const directory = await (window as Window & {
                showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
            }).showDirectoryPicker();
            const readResult = await readMarkdownDirectory(directory);
            if (!readResult.ok) {
                status.textContent = readResult.error.message;
                return;
            }
            const entries: SearchEntry[] = [];
            const excluded: string[] = [];
            for (const file of readResult.value.files) {
                const normalized = await normalize(file, webCryptoHasher);
                if (!normalized.ok) {
                    excluded.push(`${file.path}: ${normalized.error}`);
                    continue;
                }
                const chunks = await chunk(normalized.value, webCryptoHasher);
                entries.push(...chunks.map((item) => ({ source: normalized.value, chunk: item })));
            }
            const nextIndex = new SearchIndex();
            const added = nextIndex.add(entries);
            if (!added.ok) {
                status.textContent = '登録対象を減らして、もう一度フォルダを選択してください。';
                return;
            }
            index = nextIndex;
            status.textContent = `${entries.length}チャンクを読み込みました。` +
                `ファイル読込失敗: ${readResult.value.failures.length}件、除外: ${excluded.length}件`;
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
