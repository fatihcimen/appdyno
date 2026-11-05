import {
  createCipheriv,
  createDecipheriv,
  createHash,
  getDiffieHellman,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/** What a phone's network pairing is made of, with nothing of a socket here: TLV8, OPACK, SRP-6a, HKDF, ChaCha20. */

export const TAG = {
  method: 0,
  identifier: 1,
  salt: 2,
  publicKey: 3,
  proof: 4,
  encrypted: 5,
  state: 6,
  error: 7,
  signature: 10,
  info: 17,
} as const;

/** Tag, length, value; a value past 255 bytes goes in pieces under one tag. */
export function tlv(items: [number, Buffer][]): Buffer {
  const out: Buffer[] = [];
  for (const [tag, value] of items) {
    for (let at = 0; at === 0 || at < value.length; at += 255) {
      const piece = value.subarray(at, at + 255);
      out.push(Buffer.from([tag, piece.length]), piece);
    }
  }
  return Buffer.concat(out);
}

export function readTlv(data: Buffer): Map<number, Buffer> {
  const out = new Map<number, Buffer>();
  for (let at = 0; at < data.length;) {
    const tag = data[at]!;
    const n = data[at + 1] ?? -1;
    const value = data.subarray(at + 2, at + 2 + n);
    if (n < 0 || value.length < n) throw new Error('a pairing answer was cut short');
    const held = out.get(tag);
    out.set(tag, held ? Buffer.concat([held, value]) : value);
    at += 2 + n;
  }
  return out;
}

/** OPACK, as far as a pairing's words about this Mac need: a short dictionary of short strings and data. */
export function opack(dict: Record<string, string | Buffer>): Buffer {
  const item = (v: string | Buffer) => {
    const bytes = Buffer.isBuffer(v) ? v : Buffer.from(v);
    if (bytes.length > 0xff) throw new Error('too long for this pairing');
    const short = bytes.length <= 0x20;
    const start = Buffer.isBuffer(v) ? (short ? 0x70 : 0x91) : short ? 0x40 : 0x61;
    return Buffer.concat([
      short ? Buffer.from([start + bytes.length]) : Buffer.from([start, bytes.length]),
      bytes,
    ]);
  };
  const entries = Object.entries(dict);
  if (entries.length >= 15) throw new Error('too many words for this pairing');
  return Buffer.concat([
    Buffer.from([0xe0 + entries.length]),
    ...entries.flatMap(([k, v]) => [item(k), item(v)]),
  ]);
}

/** The 3072-bit group of RFC 5054's appendix A, which is RFC 3526's. */
export const big = (b: Buffer) => BigInt(`0x${b.toString('hex') || '0'}`);
export const N = big(getDiffieHellman('modp15').getPrime());
const GENERATOR = 5n;
const WIDTH = 384;

export const sha512 = (...parts: Buffer[]) => {
  const h = createHash('sha512');
  for (const p of parts) h.update(p);
  return h.digest();
};

export const wide = (n: bigint) => Buffer.from(n.toString(16).padStart(WIDTH * 2, '0'), 'hex');

export function power(base: bigint, exponent: bigint) {
  let result = 1n;
  let b = base % N;
  for (let e = exponent; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) % N;
    b = (b * b) % N;
  }
  return result;
}

/** The client's side of SRP-6a, SHA-512, as HomeKit's pairing has it. A bad key from the phone stops here. */
export function srpClient(
  salt: Buffer,
  phoneKey: Buffer,
  code: string,
  secret = randomBytes(32),
): { publicKey: Buffer; proof: Buffer; phoneProof: Buffer; key: Buffer } {
  const B = big(phoneKey);
  if (B % N === 0n) throw new Error('the phone sent no usable key');
  const a = big(secret);
  const A = power(GENERATOR, a);
  const user = 'Pair-Setup';
  const k = big(sha512(wide(N), wide(GENERATOR)));
  const x = big(sha512(salt, sha512(Buffer.from(`${user}:${code}`))));
  const u = big(sha512(wide(A), wide(B)));
  const S = power(B + N - ((k * power(GENERATOR, x)) % N), a + u * x);
  const key = sha512(wide(S));
  const group = Buffer.from(sha512(wide(N)));
  const generator = sha512(Buffer.from([Number(GENERATOR)]));
  group.forEach((v, i) => (group[i] = v ^ generator[i]!));
  const proof = sha512(group, sha512(Buffer.from(user)), salt, wide(A), wide(B), key);
  return { publicKey: wide(A), proof, phoneProof: sha512(wide(A), proof, key), key };
}

export const derive = (key: Buffer, salt: string, info: string) =>
  Buffer.from(hkdfSync('sha512', key, salt, info, 32));

export function seal(key: Buffer, nonce: Buffer, plain: Buffer) {
  const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

/** Throws on anything that was not sealed with this key. */
export function unseal(key: Buffer, nonce: Buffer, sealed: Buffer) {
  const d = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  d.setAuthTag(sealed.subarray(-16));
  return Buffer.concat([d.update(sealed.subarray(0, -16)), d.final()]);
}

/** A nonce of a pairing's named step: four zero bytes, then its eight letters. */
export const stepNonce = (step: string) =>
  Buffer.concat([Buffer.alloc(4), Buffer.from(step, 'latin1')]);

/** The nonce of a sealed request or answer: its count, little-endian, then four zero bytes. */
export function countNonce(count: number) {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64LE(BigInt(count));
  return nonce;
}
