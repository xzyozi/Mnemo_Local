import type { NormalizeError, RawFile, Result, SourceDocument } from "./domain.js";
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

export const normalize = async (
  raw: RawFile,
  hasher: Hasher,
): Promise<Result<SourceDocument, NormalizeError>> => {
  if (isInvalidPath(raw.path)) return { ok: false, error: "PATH_INVALID" };
  if (raw.body.trim().length === 0) return { ok: false, error: "DOCUMENT_EMPTY" };

  const sourceLocator = raw.path.replaceAll("\\", "/");
  return {
    ok: true,
    value: {
      sourceId: `markdown:${sourceLocator}`,
      sourceType: "markdown",
      sourceLocator,
      title: raw.title.trim() || sourceLocator.split("/").at(-1) || "Untitled",
      body: raw.body,
      sourceTimestamp: raw.updatedAt,
      sourceTimestampKind: "updated",
      sourceHash: await hasher.digest(`${sourceLocator}\n${raw.body}`),
      schemaVersion: "1",
    },
  };
};
