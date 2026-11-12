export interface Hasher {
  digest(value: string): Promise<string>;
}

const bytesToHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const webCryptoHasher: Hasher = {
  async digest(value) {
    const encoded = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return bytesToHex(digest);
  },
};
