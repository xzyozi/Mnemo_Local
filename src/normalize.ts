import type { NormalizeError, RawFile, Result, SourceDocument, SourceType } from "./domain.js";
import type { Hasher } from "./hasher.js";

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => character.charCodeAt(0) < 32);

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

export const normalizeUrl = (urlText: string): string => {
  const url = new URL(urlText);
  const isTrackingKey = (part: string): boolean => {
    const key = part.split("=", 1)[0] ?? "";
    try {
      const decodedKey = decodeURIComponent(key).toLowerCase();
      return decodedKey.startsWith("utm_") || decodedKey === "fbclid" || decodedKey === "gclid";
    } catch {
      return false;
    }
  };
  const query = url.search
    .slice(1)
    .split("&")
    .filter((part) => part.length > 0 && !isTrackingKey(part))
    .join("&");
  const base = `${url.protocol}//${url.host}${url.pathname}`;
  return query ? `${base}?${query}` : base;
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
  let sourceLocator: string;
  try {
    sourceLocator = normalizeUrl(raw.path);
  } catch {
    return { ok: false, error: "URL_EXCLUDED" };
  }
  const title = raw.title.trim() || fallbackTitleFromUrl(sourceLocator);
  const body = eventBody(title, sourceLocator);
  const sourceTimestampKind =
    raw.sourceTimestampKind ?? (sourceType === "history" ? "visited" : "created");
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
