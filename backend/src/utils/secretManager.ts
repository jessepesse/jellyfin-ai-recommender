import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

const SECRET_FILENAME = '.session_secret';

let _sessionSecret: string | null = null;

/**
 * Returns the SESSION_SECRET to use for session encryption and token hashing.
 *
 * Priority:
 * 1. SESSION_SECRET environment variable (if set)
 * 2. File at <dataDir>/.session_secret (created automatically on first run)
 *
 * The file is created with permissions 0o600 (owner read/write only).
 * Since dataDir is a Docker volume mount, the secret persists across restarts.
 */
export function getOrCreateSessionSecret(dataDir: string): string {
  if (_sessionSecret) return _sessionSecret;

  // 1. Prefer explicit env var
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    _sessionSecret = process.env.SESSION_SECRET;
    logger.info('[SecretManager] Using SESSION_SECRET from environment');
    return _sessionSecret;
  }

  // 2. Read from file or create on first run
  const secretPath = path.join(dataDir, SECRET_FILENAME);

  if (fs.existsSync(secretPath)) {
    try {
      const contents = fs.readFileSync(secretPath, 'utf8').trim();
      if (contents.length >= 32) {
        _sessionSecret = contents;
        logger.info('[SecretManager] Loaded session secret from file');
        return _sessionSecret;
      }
      logger.warn('[SecretManager] Secret file exists but is too short — regenerating');
    } catch (err) {
      logger.warn({ err }, '[SecretManager] Failed to read secret file — regenerating');
    }
  }

  // 3. Generate and persist
  const newSecret = crypto.randomBytes(64).toString('hex');

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretPath, newSecret, { encoding: 'utf8', mode: 0o600 });
    logger.info(`[SecretManager] Generated new session secret → ${secretPath}`);
  } catch (err) {
    logger.error({ err }, '[SecretManager] Failed to persist session secret — using ephemeral secret (sessions lost on restart)');
  }

  _sessionSecret = newSecret;
  return _sessionSecret;
}

/** Expose the already-initialised secret after getOrCreateSessionSecret() has been called. */
export function getSessionSecret(): string {
  if (!_sessionSecret) {
    throw new Error('Session secret not initialised — call getOrCreateSessionSecret() at startup');
  }
  return _sessionSecret;
}
