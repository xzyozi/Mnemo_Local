import type { NormalizeError, RawFile, Result, SourceDocument, SourceType } from "./domain.js";
import type { Hasher } from "./hasher.js";

const isInvalidPath = (path: string): boolean => {
  const normalizedPath = path.replaceAll("\\", "/");
  return (
    normalizedPath.length === 0 ||
    normalizedPath === "." ||
    normalizedPath.startsWith("/") ||
    /^[A-Za-z]:/.test(normalizedPath) ||
    normalizedPath.startsWith("//") ||
    normalizedPath.split("/").some((segment) => segment === ".." || segment === "." || /[\u0000-\u001f]/.test(segment))
  );
};

export const normalizeUrl = (urlText: string): string => {
  const url = new URL(urlText);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
};

const isValidHttpUrl = (urlText: string): boolean => {
  try {
    const url = new URL(urlText);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const fallbackTitleFromUrl = (urlText: string): string => {
  const url = new URL(urlText);
  return url.pathname.split("/").filter(Boolean).at(-1) || url.hostname || "Untitled";
};

const eventBody = (title: string, locator: string): string => {
  const url = new URL(locator);
  return `${title} ${url.hostname}${url.pathname}`.trim();
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
        sourceType,
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

  if (!isValidHttpUrl(raw.path)) return { ok: false, error: "URL_EXCLUDED" };
  const sourceLocator = normalizeUrl(raw.path);
  const title = raw.title.trim() || fallbackTitleFromUrl(sourceLocator);
  const body = eventBody(title, sourceLocator);
  const sourceTimestampKind = raw.sourceTimestampKind ?? (sourceType === "history" ? "visited" : "created");
  return {
    ok: true,
    value: {
      sourceId: `${sourceType}:${sourceLocator}`,
      sourceType,
      sourceLocator,
      title,
      body,
      sourceTimestamp: raw.updatedAt,
      sourceTimestampKind,
      sourceHash: await hasher.digest(`${sourceLocator}\n${body}`),
      schemaVersion: "1",
    },
  };
};
