import { describe, expect, it } from 'vitest';
import { chunk } from './chunk.js';
import type { Hasher } from './hasher.js';
import { normalize } from './normalize.js';
import { SearchIndex } from './search.js';

const fakeHasher: Hasher = {
  async digest(value) {
    return `hash:${value}`;
  },
};

const source = async (body = '# 設計\n検索設計を確認する') => {
  const result = await normalize({ path: 'notes/a.md', title: 'A', body, updatedAt: 1 }, fakeHasher);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe('Phase 1 domain', () => {
  it('rejects absolute and parent paths', async () => {
    await expect(normalize({ path: '../a.md', title: 'A', body: 'x', updatedAt: 1 }, fakeHasher)).resolves.toEqual({
      ok: false,
      error: 'PATH_INVALID',
    });
    await expect(normalize({ path: 'C:notes/a.md', title: 'A', body: 'x', updatedAt: 1 }, fakeHasher)).resolves.toEqual({
      ok: false,
      error: 'PATH_INVALID',
    });
  });

  it('normalizes title and creates hashed chunks', async () => {
    const document = await source();
    expect(document.title).toBe('A');
    expect(document.schemaVersion).toBe('1');
    const chunks = await chunk(document, fakeHasher);
    expect(chunks[0]?.contentHash).toContain('hash:');
  });

  it('supports three-gram, two-gram, and one-character searches', async () => {
    const document = await source();
    const chunks = await chunk(document, fakeHasher);
    const index = new SearchIndex();
    expect(index.add(chunks.map((item) => ({ source: document, chunk: item })))).toEqual({ ok: true, value: undefined });
    expect(index.search('検索').ok).toBe(true);
    expect(index.search('設').ok).toBe(true);
  });

  it('rejects an over-sized registration atomically', async () => {
    const document = await source('本文');
    const chunks = await chunk(document, fakeHasher);
    const index = new SearchIndex();
    const tooMany = Array.from({ length: 50_001 }, (_, index) => ({
      source: document,
      chunk: { ...chunks[0]!, chunkId: `chunk-${index}` },
    }));
    expect(index.add(tooMany)).toEqual({ ok: false, error: 'INDEX_SIZE_LIMIT' });
    expect(index.search('本文')).toEqual({ ok: true, value: [] });
  });
});
