import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>;

/** scrypt parameters. N=16384 keeps hashing ~60ms on a laptop, which is fine for MVP auth. */
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 64 } as const;

export function newId(): string {
  return randomUUID();
}

/** URL-safe random token (default 32 bytes / 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. Session tokens are stored with this (tokens are already 256-bit random). */
export function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Hex(input: string): string {
  return digest(input);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltStr, keyStr] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const salt = Buffer.from(saltStr, 'base64url');
  const expected = Buffer.from(keyStr, 'base64url');
  const key = await scrypt(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
    maxmem: 64 * 1024 * 1024,
  });
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

/** 6-digit pickup code, uniformly random, zero-padded. */
export function generatePickupCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Pickup-code hash. The code space is only 10^6, so we pepper with the server
 * secret and salt with the reservation id: an attacker with a DB dump cannot
 * build a fast lookup table, and the 5-attempt lock stops online guessing.
 */
export function hashPickupCode(code: string, reservationId: string, secret: string): string {
  return createHmac('sha256', `${secret}:pickup-code`)
    .update(`${reservationId}:${code}`)
    .digest('hex');
}

export function verifyPickupCode(
  code: string,
  reservationId: string,
  secret: string,
  storedHash: string,
): boolean {
  const candidate = Buffer.from(hashPickupCode(code, reservationId, secret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function codeKey(secret: string): Buffer {
  return createHmac('sha256', `${secret}:pickup-code-encryption`).digest();
}

/**
 * AES-256-GCM encryption of the pickup code so the recipient can re-read it on
 * their reservations page (see docs/DECISIONS.md).
 */
export function encryptPickupCode(code: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', codeKey(secret), iv);
  const enc = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join(':');
}

export function decryptPickupCode(payload: string, secret: string): string | null {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, ivStr, tagStr, dataStr] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      codeKey(secret),
      Buffer.from(ivStr, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagStr, 'base64url'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataStr, 'base64url')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
