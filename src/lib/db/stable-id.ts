// Deterministische UUIDs (RFC 4122, Version 5) für Katalogdaten.
// App und Datenbank leiten dieselbe ID aus dem Slug ab, ohne sich abstimmen zu müssen.
// Folge: Ein Slug ist eine stabile Identität. Ihn umzubenennen erzeugt eine neue ID.

/** Namespace dieser App. Niemals ändern – sonst ändern sich alle Katalog-IDs. */
export const CATALOG_NAMESPACE = "7c1e4f7a-2d3b-4a8e-9f61-5b0c2e8d4a17";

export type CatalogKind = "muscle" | "equipment" | "exercise" | "source" | "guideline";

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

/** Kompakte, synchrone SHA-1-Implementierung (Web Crypto ist nur asynchron verfügbar). */
function sha1(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) [f, k] = [(b & c) | (~b & d), 0x5a827999];
      else if (i < 40) [f, k] = [b ^ c ^ d, 0x6ed9eba1];
      else if (i < 60) [f, k] = [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
      else [f, k] = [b ^ c ^ d, 0xca62c1d6];
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h));
  return out;
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function uuidV5(name: string, namespace: string): string {
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nameBytes.length);
  input.set(uuidToBytes(namespace));
  input.set(nameBytes, 16);
  const hash = sha1(input).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50; // Version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC-4122-Variante
  return bytesToUuid(hash);
}

export function catalogId(kind: CatalogKind, slug: string): string {
  return uuidV5(`${kind}:${slug}`, CATALOG_NAMESPACE);
}
