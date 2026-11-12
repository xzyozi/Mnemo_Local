import type { RawFile, Result, SourceDocument, NormalizeError } from './domain.js';
import type { Hasher } from './hasher.js';

const isInvalidPath = (path: string): boolean =>
  path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.split(/[\\/]/).includes('..');

export const normalize = async (
  raw: RawFile,
  hasher: Hasher,
): Promise<Result<SourceDocument, NormalizeError>> => {
  if (isInvalidPath(raw.path)) return { ok: false, error: 'PATH_INVALID' };
  if (raw.body.trim().length === 0) return { ok: false, error: 'DOCUMENT_EMPTY' };

  const sourceLocator = raw.path.replaceAll('\\', '/');
  return {
    ok: true,
    value: {
      sourceId: `markdown:${sourceLocator}`,
      sourceType: 'markdown',
      sourceLocator,
      title: raw.title || sourceLocator.split('/').at(-1) || 'Untitled',
      body: raw.body,
      sourceTimestamp: raw.updatedAt,
      sourceTimestampKind: 'updated',
      sourceHash: await hasher.digest(`${sourceLocator}\n${raw.body}`),
      schemaVersion: '1',
    },
  };
};
