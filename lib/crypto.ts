// Web Crypto helpers (Workers + Node). Keys are 32-byte hex strings (docs/ENV.md).
const enc = new TextEncoder();
const dec = new TextDecoder();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error("Key must be 32 bytes as 64 hex characters");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function aesKey(hexKey: string) {
  return crypto.subtle.importKey("raw", hexToBytes(hexKey), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM. Output: "v1.<iv>.<ciphertext>" (base64url). */
export async function encryptSecret(plaintext: string, hexKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(hexKey), enc.encode(plaintext)));
  return `v1.${toBase64Url(iv)}.${toBase64Url(ct)}`;
}

export async function decryptSecret(token: string, hexKey: string): Promise<string> {
  const [version, iv, ct] = token.split(".");
  if (version !== "v1" || !iv || !ct) throw new Error("Unrecognized ciphertext format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) }, await aesKey(hexKey), fromBase64Url(ct));
  return dec.decode(pt);
}

/** HMAC-SHA256 over `message` with a key derived from `secret` and a purpose label. */
export async function hmac(secret: string, purpose: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`${purpose}:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message))));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a), bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Checks an `Authorization: Bearer <token>` header against the expected secret. */
export function bearerMatches(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && safeEqual(token, expected);
}
