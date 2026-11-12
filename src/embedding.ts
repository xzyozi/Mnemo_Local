import type { EmbeddingError, Result } from "./domain.js";

export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  embedPassage(text: string): Promise<Result<number[], EmbeddingError>>;
  embedQuery(text: string): Promise<Result<number[], EmbeddingError>>;
}

const normalizeVector = (vector: number[]): number[] => {
  let sumSq = 0;
  for (const v of vector) {
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
};

const hashStringToVector = (str: string, dimensions: number): number[] => {
  const vector = new Array<number>(dimensions).fill(0);
  let hash1 = 0x811c9dc5;
  let hash2 = 0x27d4eb2f;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    hash1 = (hash1 ^ code) * 0x01000193;
    hash2 = (hash2 ^ (code << 8)) * 0x01000193;
    const index = Math.abs(hash1 + i * 31) % dimensions;
    vector[index] = (vector[index] ?? 0) + ((hash2 & 0xff) / 255 - 0.5);
  }

  // Ensure at least non-zero values
  for (let i = 0; i < dimensions; i++) {
    const v = vector[i] ?? 0;
    if (v === 0) {
      vector[i] = Math.sin((i + 1) * hash1);
    }
  }

  return normalizeVector(vector);
};

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;

  constructor(modelId = "multilingual-e5-small-mock", dimensions = 384) {
    this.modelId = modelId;
    this.dimensions = dimensions;
  }

  async embedPassage(text: string): Promise<Result<number[], EmbeddingError>> {
    if (!text.trim()) {
      return { ok: false, error: "EMBEDDING_EMPTY" };
    }
    const prefixed = `passage: ${text}`;
    const vector = hashStringToVector(prefixed, this.dimensions);
    return { ok: true, value: vector };
  }

  async embedQuery(text: string): Promise<Result<number[], EmbeddingError>> {
    if (!text.trim()) {
      return { ok: false, error: "EMBEDDING_EMPTY" };
    }
    const prefixed = `query: ${text}`;
    const vector = hashStringToVector(prefixed, this.dimensions);
    return { ok: true, value: vector };
  }
}
