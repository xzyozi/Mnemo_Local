import type { RawFile, Result, SourceType } from "./domain.js";

export interface FileReadError {
  code: "FILE_READ_FAILED";
  path: string;
  message: string;
}

export interface DirectoryReadError {
  code: "DIRECTORY_READ_FAILED";
  message: string;
}

export interface RawFileBatch {
  files: RawFile[];
  failures: FileReadError[];
}

export type InputReadResult = Result<RawFileBatch, DirectoryReadError>;

const isDirectoryHandle = (entry: FileSystemHandle): entry is FileSystemDirectoryHandle =>
  entry.kind === "directory";

const isFileHandle = (entry: FileSystemHandle): entry is FileSystemFileHandle =>
  entry.kind === "file";

export const readMarkdownFiles = async (
  directory: FileSystemDirectoryHandle,
  parentPath = "",
): Promise<RawFileBatch> => {
  const files: RawFile[] = [];
  const failures: FileReadError[] = [];
  for await (const [name, entry] of directory.entries()) {
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    if (isDirectoryHandle(entry)) {
      const nested = await readMarkdownFiles(entry, relativePath);
      files.push(...nested.files);
      failures.push(...nested.failures);
      continue;
    }
    if (!isFileHandle(entry) || !name.toLowerCase().endsWith(".md")) continue;
    try {
      const file = await entry.getFile();
      files.push({
        path: relativePath,
        title: name.replace(/\.md$/i, ""),
        body: await file.text(),
        updatedAt: file.lastModified,
        sourceType: "markdown",
        sourceTimestampKind: "updated",
      });
    } catch {
      failures.push({
        code: "FILE_READ_FAILED",
        path: relativePath,
        message: "Markdownファイルを読み込めませんでした。",
      });
    }
  }
  return { files, failures };
};

export const readMarkdownDirectory = async (
  directory: FileSystemDirectoryHandle,
): Promise<InputReadResult> => {
  try {
    return { ok: true, value: await readMarkdownFiles(directory) };
  } catch {
    return {
      ok: false,
      error: { code: "DIRECTORY_READ_FAILED", message: "フォルダを列挙できませんでした。" },
    };
  }
};

const parseJsonExport = (
  fileName: string,
  content: string,
  fallbackUpdatedAt: number,
): Result<RawFile[], FileReadError> => {
  try {
    const parsed = JSON.parse(content);
    const records: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.history)
        ? parsed.history
        : Array.isArray(parsed.bookmarks)
          ? parsed.bookmarks
          : Array.isArray(parsed.items)
            ? parsed.items
            : [];

    const isHistory =
      fileName.toLowerCase().includes("history") ||
      (typeof parsed === "object" && parsed !== null && "history" in parsed);
    const inferredType: SourceType = isHistory ? "history" : "bookmark";

    const files: RawFile[] = [];
    for (const item of records) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as Record<string, unknown>;
      const url = String(rec.url ?? rec.path ?? rec.link ?? "").trim();
      if (!url) continue;
      const title = String(rec.title ?? rec.name ?? "").trim();
      const body = String(rec.body ?? rec.text ?? rec.snippet ?? (title || url)).trim();
      const rawTime = rec.time ?? rec.lastVisitTime ?? rec.updatedAt ?? rec.dateAdded;
      let updatedAt = fallbackUpdatedAt;
      if (typeof rawTime === "number" && Number.isFinite(rawTime) && rawTime > 0) {
        // Chrome WebKit timestamps are in microseconds since 1601-01-01
        updatedAt = rawTime > 1e15 ? Math.floor((rawTime - 11644473600000000) / 1000) : rawTime;
      } else if (typeof rawTime === "string") {
        const parsedTime = Date.parse(rawTime);
        if (Number.isFinite(parsedTime)) updatedAt = parsedTime;
      }

      files.push({
        path: url,
        title,
        body,
        updatedAt,
        sourceType: inferredType,
        sourceTimestampKind: inferredType === "history" ? "visited" : "created",
      });
    }
    return { ok: true, value: files };
  } catch {
    return {
      ok: false,
      error: {
        code: "FILE_READ_FAILED",
        path: fileName,
        message: "JSON形式のエクスポートファイルを解析できませんでした。",
      },
    };
  }
};

const parseHtmlExport = (
  fileName: string,
  content: string,
  fallbackUpdatedAt: number,
): Result<RawFile[], FileReadError> => {
  try {
    const linkRegex =
      /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'](?:\s+[^>]*?add_date=["'](\d+)["'])?[^>]*>(.*?)<\/a>/gi;
    const files: RawFile[] = [];
    let match: RegExpExecArray | null = null;
    while (true) {
      match = linkRegex.exec(content);
      if (match === null) break;
      const url = match[1]?.trim();
      if (!url) continue;
      const addDateSeconds = match[2] ? Number.parseInt(match[2], 10) : undefined;
      const updatedAt =
        addDateSeconds && Number.isFinite(addDateSeconds)
          ? addDateSeconds * 1000
          : fallbackUpdatedAt;
      const rawTitle = match[3]?.replace(/<[^>]+>/g, "").trim() ?? "";
      const title = rawTitle || url;
      files.push({
        path: url,
        title,
        body: title,
        updatedAt,
        sourceType: "bookmark",
        sourceTimestampKind: "created",
      });
    }
    return { ok: true, value: files };
  } catch {
    return {
      ok: false,
      error: {
        code: "FILE_READ_FAILED",
        path: fileName,
        message: "HTMLブックマークファイルを解析できませんでした。",
      },
    };
  }
};

export const parseStructuredExport = (
  fileName: string,
  content: string,
  fallbackUpdatedAt = Date.now(),
): Result<RawFile[], FileReadError> => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) {
    return parseJsonExport(fileName, content, fallbackUpdatedAt);
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return parseHtmlExport(fileName, content, fallbackUpdatedAt);
  }
  return {
    ok: false,
    error: {
      code: "FILE_READ_FAILED",
      path: fileName,
      message: "サポートされていないエクスポート形式です。JSONまたはHTMLを選択してください。",
    },
  };
};

export const readInputFiles = async (files: Iterable<File>): Promise<RawFileBatch> => {
  const rawFiles: RawFile[] = [];
  const failures: FileReadError[] = [];

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    try {
      const text = await file.text();
      if (lowerName.endsWith(".md")) {
        rawFiles.push({
          path: file.name,
          title: file.name.replace(/\.md$/i, ""),
          body: text,
          updatedAt: file.lastModified || Date.now(),
          sourceType: "markdown",
          sourceTimestampKind: "updated",
        });
      } else if (
        lowerName.endsWith(".json") ||
        lowerName.endsWith(".html") ||
        lowerName.endsWith(".htm")
      ) {
        const parsed = parseStructuredExport(file.name, text, file.lastModified || Date.now());
        if (parsed.ok) {
          rawFiles.push(...parsed.value);
        } else {
          failures.push(parsed.error);
        }
      }
    } catch {
      failures.push({
        code: "FILE_READ_FAILED",
        path: file.name,
        message: "ファイルを読み込めませんでした。",
      });
    }
  }

  return { files: rawFiles, failures };
};
