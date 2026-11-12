import type { MemoryChunk, SourceDocument } from "./domain.js";
import type { Hasher } from "./hasher.js";

const TARGET_LENGTH = 500;

const splitText = (body: string): string[] => {
  const sections = body.split(/(?=^#{1,6}\s)/m).filter((section) => section.trim());
  return sections.flatMap((section) => {
    if (section.length <= TARGET_LENGTH) return [section];
    const chunks: string[] = [];
    for (let index = 0; index < section.length; index += TARGET_LENGTH) {
      chunks.push(section.slice(index, index + TARGET_LENGTH));
    }
    return chunks;
  });
};

export const chunk = async (source: SourceDocument, hasher: Hasher): Promise<MemoryChunk[]> => {
  const parts = splitText(source.body);
  let cursor = 0;
  const chunks: MemoryChunk[] = [];
  for (const [ordinal, body] of parts.entries()) {
    const charStart = source.body.indexOf(body, cursor);
    const charEnd = charStart + body.length;
    chunks.push({
      chunkId: `${source.sourceId}:${ordinal}`,
      sourceId: source.sourceId,
      ordinal,
      body,
      contentHash: await hasher.digest(`${source.sourceId}\n${ordinal}\n${body}`),
      charStart,
      charEnd,
      schemaVersion: "1",
    });
    cursor = charEnd;
  }
  return chunks;
};
