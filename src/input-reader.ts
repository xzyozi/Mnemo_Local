import type { RawFile } from './domain.js';

export interface FileReadError {
  code: 'FILE_READ_FAILED';
  path: string;
  message: string;
}

export interface RawFileBatch {
  files: RawFile[];
  failures: FileReadError[];
}

const readMarkdownFiles = async (
  directory: FileSystemDirectoryHandle,
  parentPath = '',
): Promise<RawFileBatch> => {
  const files: RawFile[] = [];
  const failures: FileReadError[] = [];
  for await (const [name, entry] of directory.entries()) {
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    if (entry.kind === 'directory') {
      const nested = await readMarkdownFiles(entry, relativePath);
      files.push(...nested.files);
      failures.push(...nested.failures);
      continue;
    }
    if (!name.toLowerCase().endsWith('.md')) continue;
    try {
      const file = await entry.getFile();
      files.push({ path: relativePath, title: name.replace(/\.md$/i, ''), body: await file.text(), updatedAt: file.lastModified });
    } catch {
      failures.push({ code: 'FILE_READ_FAILED', path: relativePath, message: 'Markdownファイルを読み込めませんでした。' });
    }
  }
  return { files, failures };
};

export const readMarkdownDirectory = (directory: FileSystemDirectoryHandle): Promise<RawFileBatch> =>
  readMarkdownFiles(directory);
