import type { NormalizeError, RawFile, Result, SourceDocument, SourceType } from "./domain.js";
import type { Hasher } from "./hasher.js";

const hasControlCharacter = (segment: string): boolean =>
  [...segment].some((char) => char.charCodeAt(0) <= 0x1f);

const isInvalidPath = (path: string): boolean => {
  const normalizedPath = path.replaceAll("\\", "/");
  return (
    normalizedPath.length === 0 ||
    normalizedPath === "." ||
    normalizedPath.startsWith("/") ||
    /^[A-Za-z]:/.test(normalizedPath) ||
    normalizedPath.startsWith("//") ||
    normalizedPath
      .split("/")
      .some((segment) => segment === ".." || segment === "." || hasControlCharacter(segment))
  );
};

const isValidHttpUrl = (urlText: string): boolean => {
  try {
    const parsed = new URL(urlText);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const fallbackTitleFromUrl = (urlText: string): string => {
  try {
    const parsed = new URL(urlText);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
    return lastSegment || parsed.hostname || "Untitled";
  } catch {
    return "Untitled";
  }
};

export const normalize = async (
  raw: RawFile,
  hasher: Hasher,
): Promise<Result<SourceDocument, NormalizeError>> => {
  const sourceType: SourceType = raw.sourceType ?? "markdown";

  if (sourceType === "markdown") {
    if (isInvalidPath(raw.path)) return { ok: false, error: "PATH_INVALID" };
    if (raw.body.trim().length === 0) return { ok: false, error: "DOCUMENT_EMPTY" };

    const sourceLocator = raw.path.replaceAll("\\", "/");
    const title = raw.title.trim() || sourceLocator.split("/").at(-1) || "Untitled";
    return {
      ok: true,
      value: {
        sourceId: `markdown:${sourceLocator}`,
        sourceType: "markdown",
        sourceLocator,
        title,
        body: raw.body,
        sourceTimestamp: raw.updatedAt,
        sourceTimestampKind: raw.sourceTimestampKind ?? "updated",
        sourceHash: await hasher.digest(`${sourceLocator}\n${raw.body}`),
        schemaVersion: "1",
      },
    };
  }

  // history or bookmark
  if (!isValidHttpUrl(raw.path)) {
    return { ok: false, error: "URL_EXCLUDED" };
  }
  if (raw.body.trim().length === 0) {
    return { ok: false, error: "DOCUMENT_EMPTY" };
  }

  const sourceLocator = raw.path;
  const title = raw.title.trim() || fallbackTitleFromUrl(sourceLocator);
  const sourceTimestampKind =
    raw.sourceTimestampKind ?? (sourceType === "history" ? "visited" : "created");
  const sourceId =
    sourceType === "history"
      ? `history:${sourceLocator}:${raw.updatedAt}`
      : `bookmark:${sourceLocator}`;

  return {
    ok: true,
    value: {
      sourceId,
      sourceType,
      sourceLocator,
      title,
      body: raw.body,
      sourceTimestamp: raw.updatedAt,
      sourceTimestampKind,
      sourceHash: await hasher.digest(`${sourceLocator}\n${raw.body}`),
      schemaVersion: "1",
    },
  };
};
