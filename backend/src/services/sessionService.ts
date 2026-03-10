import prisma from '../db';
import {
  generateSessionToken,
  hashSessionToken,
  encryptValue,
  decryptValue,
  getSessionExpiry,
  isSessionExpired,
} from '../utils/session';
import { logger } from '../utils/logger';
import { getEnv } from '../utils/env';

export interface CreateSessionInput {
  userId: number;
  jellyfinToken?: string;       // Raw Jellyfin token — encrypted before storage
  credential?: string;          // Plaintext password — encrypted before storage
  jellyfinUserId?: string;
  jellyfinServerUrl?: string;
  isLocalOnly?: boolean;
}

export interface SessionData {
  sessionId: number;
  userId: number;
  username: string;
  isSystemAdmin: boolean;
  jellyfinToken: string | null;     // Decrypted, ready for API calls
  jellyfinUserId: string | null;
  jellyfinServerUrl: string | null;
  isLocalOnly: boolean;
  credential: string | null;        // Decrypted — only used for Jellyfin re-auth
}

/**
 * Create a new session after successful authentication.
 * Returns the raw session token — sent to the client ONCE, never stored raw.
 */
export async function createSession(input: CreateSessionInput): Promise<string> {
  const { userId, jellyfinToken, credential, jellyfinUserId, jellyfinServerUrl, isLocalOnly = false } = input;
  const ttlDays = getEnv().SESSION_TTL_DAYS;

  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = getSessionExpiry(ttlDays);

  await prisma.session.create({
    data: {
      tokenHash,
      userId,
      jellyfinTokenEnc: jellyfinToken ? encryptValue(jellyfinToken) : null,
      credentialEnc: credential ? encryptValue(credential) : null,
      jellyfinUserId: jellyfinUserId ?? null,
      jellyfinServerUrl: jellyfinServerUrl ?? null,
      isLocalOnly,
      expiresAt,
    },
  });

  logger.info(`[Session] Created session for userId=${userId}, ttl=${ttlDays}d`);
  return rawToken;
}

/**
 * Validate a session token and return the session data with sliding expiry.
 * Returns null if the session is not found or has expired.
 */
export async function validateSession(rawToken: string): Promise<SessionData | null> {
  const tokenHash = hashSessionToken(rawToken);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;

  if (isSessionExpired(session.expiresAt)) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    logger.info(`[Session] Expired session cleaned up for userId=${session.userId}`);
    return null;
  }

  // Sliding window: push expiry forward on each use
  const newExpiry = getSessionExpiry(getEnv().SESSION_TTL_DAYS);
  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date(), expiresAt: newExpiry },
  }).catch((err) => {
    logger.warn({ err }, '[Session] Failed to update session sliding window');
  });

  let jellyfinToken: string | null = null;
  if (session.jellyfinTokenEnc) {
    try {
      jellyfinToken = decryptValue(session.jellyfinTokenEnc);
    } catch (err) {
      logger.error({ err }, '[Session] Failed to decrypt Jellyfin token');
    }
  }

  let credential: string | null = null;
  if (session.credentialEnc) {
    try {
      credential = decryptValue(session.credentialEnc);
    } catch (err) {
      logger.error({ err }, '[Session] Failed to decrypt credential');
    }
  }

  return {
    sessionId: session.id,
    userId: session.userId,
    username: session.user.username,
    isSystemAdmin: session.user.isSystemAdmin,
    jellyfinToken,
    jellyfinUserId: session.jellyfinUserId,
    jellyfinServerUrl: session.jellyfinServerUrl,
    isLocalOnly: session.isLocalOnly,
    credential,
  };
}

/**
 * Invalidate a specific session (logout from current device).
 */
export async function deleteSession(rawToken: string): Promise<void> {
  const tokenHash = hashSessionToken(rawToken);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

/**
 * Invalidate all sessions for a user (force-logout all devices).
 */
export async function deleteAllUserSessions(userId: number): Promise<void> {
  const result = await prisma.session.deleteMany({ where: { userId } });
  logger.info(`[Session] Invalidated ${result.count} sessions for userId=${userId}`);
}

/**
 * Update the stored Jellyfin token after a successful re-authentication.
 */
export async function updateSessionJellyfinToken(sessionId: number, newJellyfinToken: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { jellyfinTokenEnc: encryptValue(newJellyfinToken) },
  });
}

/**
 * Delete all expired sessions. Call at startup and from a periodic cron job.
 */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    logger.info(`[Session] Purged ${result.count} expired sessions`);
  }
  return result.count;
}
