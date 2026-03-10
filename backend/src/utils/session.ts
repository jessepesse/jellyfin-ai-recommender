import crypto from 'crypto';
import { getSessionSecret } from './secretManager';

// ============================================================
// Key Derivation
// ============================================================

/**
 * Derive a 32-byte AES-256 key from the session secret using HKDF.
 * Domain-separated from the HMAC key so the same secret produces different keys.
 */
function deriveEncryptionKey(): Buffer {
  const secret = getSessionSecret();
  const salt = Buffer.from('jellyfin-ai-recommender-session-v1', 'utf8');
  const ikm = Buffer.from(secret, 'utf8');
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const info = Buffer.from('aes-256-gcm-session-key', 'utf8');
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
}

function deriveHmacKey(): Buffer {
  const secret = getSessionSecret();
  const salt = Buffer.from('jellyfin-ai-recommender-session-v1', 'utf8');
  const ikm = Buffer.from(secret, 'utf8');
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const info = Buffer.from('hmac-session-token-key', 'utf8');
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
}

// ============================================================
// AES-256-GCM Encrypt / Decrypt
// ============================================================

/**
 * Encrypt a value for storage in the DB.
 * Returns: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
export function encryptValue(plaintext: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt a value from DB storage.
 * Throws if decryption or authentication fails (tampering / key mismatch).
 */
export function decryptValue(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted value format');

  const key = deriveEncryptionKey();
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Session value decryption failed — possible tampering or key rotation');
  }
}

// ============================================================
// Session Token Generation and Hashing
// ============================================================

/**
 * Generate a cryptographically random session token (64 hex chars = 256 bits).
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a session token for DB storage using HMAC-SHA256.
 * The raw token is never stored — only the hash.
 */
export function hashSessionToken(token: string): string {
  const key = deriveHmacKey();
  return crypto.createHmac('sha256', key).update(token).digest('hex');
}

// ============================================================
// Session Expiry Helpers
// ============================================================

export function getSessionExpiry(ttlDays: number = 30): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + ttlDays);
  return expiry;
}

export function isSessionExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}
