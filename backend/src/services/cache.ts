/**
 * Unified caching service for the application
 * Provides consistent caching with TTL support for different data types
 */

import NodeCache from 'node-cache';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// Cache configuration
const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour default
const RECOMMENDATION_TTL_SECONDS = 60 * 30; // 30 minutes for recommendations
const CONFIG_TTL_SECONDS = 30; // 30 seconds for config (matches ConfigService)
const JELLYSEERR_TTL_SECONDS = 60 * 60 * 12; // 12 hours for Jellyseerr data
const PERSISTENT_CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Cache namespaces
export type CacheNamespace =
  | 'recommendations'
  | 'jellyseerr'
  | 'config'
  | 'taste'
  | 'tmdb'
  | 'discover'
  | 'api'
  | 'general';

type PersistentCacheResult<T> = {
  value: T;
  ttlSeconds: number;
};

// Internal cache instance
const cache = new NodeCache({
  stdTTL: DEFAULT_TTL_SECONDS,
  checkperiod: 120, // Check for expired keys every 2 minutes
  useClones: false, // Return references for better performance
});

// In-flight request registry: maps a full cache key to the promise currently
// computing its value.  Concurrent callers that see a cache miss for the same
// key will join the existing promise instead of launching duplicate fetchers,
// eliminating the cache-stampede problem under high concurrency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inFlight = new Map<string, Promise<any>>();

const PERSISTENT_NAMESPACES = new Set<CacheNamespace>([
  'recommendations',
  'jellyseerr',
  'taste',
  'tmdb',
  'discover',
  'api',
  'general',
]);

function resolvePersistentCachePath(): string {
  const explicit = (process.env.CACHE_DB_PATH || '').trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  }

  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  if (databaseUrl.startsWith('file:')) {
    const dbPathRaw = databaseUrl.replace(/^file:/, '');
    const dbPath = path.isAbsolute(dbPathRaw) ? dbPathRaw : path.resolve(process.cwd(), dbPathRaw);
    return path.join(path.dirname(dbPath), 'cache.db');
  }

  return path.resolve(process.cwd(), 'data', 'cache.db');
}

class PersistentCacheStore {
  private db: Database.Database | null = null;
  private enabled = false;
  private lastCleanupAt = 0;

  constructor() {
    try {
      const cacheDbPath = resolvePersistentCachePath();
      fs.mkdirSync(path.dirname(cacheDbPath), { recursive: true });
      this.db = new Database(cacheDbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS persistent_cache (
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (namespace, key)
        );
        CREATE INDEX IF NOT EXISTS idx_persistent_cache_expires_at
          ON persistent_cache(expires_at);
      `);
      this.enabled = true;
      console.info(`[Cache] Persistent cache enabled at ${cacheDbPath}`);
    } catch (error) {
      this.enabled = false;
      this.db = null;
      console.warn('[Cache] Persistent cache disabled (SQLite init failed):', error);
    }
  }

  private supports(namespace: CacheNamespace): boolean {
    return this.enabled && this.db !== null && PERSISTENT_NAMESPACES.has(namespace);
  }

  private cleanupExpiredIfNeeded(): void {
    if (!this.db || !this.enabled) return;
    const now = Date.now();
    if (now - this.lastCleanupAt < PERSISTENT_CACHE_CLEANUP_INTERVAL_MS) return;

    this.lastCleanupAt = now;
    try {
      this.db.prepare('DELETE FROM persistent_cache WHERE expires_at <= ?').run(now);
    } catch (error) {
      console.warn('[Cache] Failed to cleanup expired persistent entries:', error);
    }
  }

  getWithTTL<T>(namespace: CacheNamespace, key: string): PersistentCacheResult<T> | undefined {
    if (!this.supports(namespace)) return undefined;
    this.cleanupExpiredIfNeeded();

    try {
      const now = Date.now();
      const row = this.db!.prepare(
        `SELECT value, expires_at
         FROM persistent_cache
         WHERE namespace = ? AND key = ?`
      ).get(namespace, key) as { value: string; expires_at: number } | undefined;

      if (!row) return undefined;
      if (row.expires_at <= now) {
        this.del(namespace, key);
        return undefined;
      }

      const ttlSeconds = Math.max(1, Math.ceil((row.expires_at - now) / 1000));
      return {
        value: JSON.parse(row.value) as T,
        ttlSeconds,
      };
    } catch (error) {
      console.warn(`[Cache] Failed to read persistent entry (${namespace}:${key}):`, error);
      return undefined;
    }
  }

  set<T>(namespace: CacheNamespace, key: string, value: T, ttlSeconds: number): void {
    if (!this.supports(namespace)) return;
    this.cleanupExpiredIfNeeded();

    try {
      const now = Date.now();
      const expiresAt = now + Math.max(1, ttlSeconds) * 1000;
      const serialized = JSON.stringify(value);
      this.db!.prepare(
        `INSERT INTO persistent_cache(namespace, key, value, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`
      ).run(namespace, key, serialized, expiresAt, now);
    } catch (error) {
      console.warn(`[Cache] Failed to persist entry (${namespace}:${key}):`, error);
    }
  }

  has(namespace: CacheNamespace, key: string): boolean {
    if (!this.supports(namespace)) return false;
    this.cleanupExpiredIfNeeded();
    try {
      const now = Date.now();
      const row = this.db!.prepare(
        `SELECT 1
         FROM persistent_cache
         WHERE namespace = ? AND key = ? AND expires_at > ?
         LIMIT 1`
      ).get(namespace, key, now);
      return !!row;
    } catch {
      return false;
    }
  }

  del(namespace: CacheNamespace, key: string): number {
    if (!this.supports(namespace)) return 0;
    try {
      const info = this.db!.prepare(
        `DELETE FROM persistent_cache
         WHERE namespace = ? AND key = ?`
      ).run(namespace, key);
      return Number(info.changes || 0);
    } catch {
      return 0;
    }
  }

  clearNamespace(namespace: CacheNamespace): number {
    if (!this.supports(namespace)) return 0;
    try {
      const info = this.db!.prepare(
        `DELETE FROM persistent_cache
         WHERE namespace = ?`
      ).run(namespace);
      return Number(info.changes || 0);
    } catch {
      return 0;
    }
  }

  clearAll(): number {
    if (!this.enabled || !this.db) return 0;
    try {
      const info = this.db.prepare('DELETE FROM persistent_cache').run();
      return Number(info.changes || 0);
    } catch {
      return 0;
    }
  }

  countActiveKeys(): number {
    if (!this.enabled || !this.db) return 0;
    this.cleanupExpiredIfNeeded();
    try {
      const now = Date.now();
      const row = this.db.prepare('SELECT COUNT(*) AS count FROM persistent_cache WHERE expires_at > ?').get(now) as { count: number };
      return Number(row?.count || 0);
    } catch {
      return 0;
    }
  }
}

const persistentCache = new PersistentCacheStore();

/**
 * Get TTL for a specific namespace
 */
function getTTLForNamespace(namespace: CacheNamespace): number {
  switch (namespace) {
    case 'recommendations':
      return RECOMMENDATION_TTL_SECONDS;
    case 'jellyseerr':
      return JELLYSEERR_TTL_SECONDS;
    case 'config':
      return CONFIG_TTL_SECONDS;
    case 'taste':
      return RECOMMENDATION_TTL_SECONDS;
    case 'tmdb':
    case 'discover':
      return JELLYSEERR_TTL_SECONDS; // 12 hours for TMDB data
    default:
      return DEFAULT_TTL_SECONDS;
  }
}

/**
 * Build a namespaced cache key
 */
function buildKey(namespace: CacheNamespace, key: string): string {
  return `${namespace}:${key}`;
}

/**
 * Unified Cache Service
 */
export const CacheService = {
  /**
   * Get a value from cache
   */
  get<T>(namespace: CacheNamespace, key: string): T | undefined {
    const fullKey = buildKey(namespace, key);
    const memoryHit = cache.get<T>(fullKey);
    if (memoryHit !== undefined) return memoryHit;

    const persistentHit = persistentCache.getWithTTL<T>(namespace, key);
    if (persistentHit !== undefined) {
      cache.set(fullKey, persistentHit.value, persistentHit.ttlSeconds);
      return persistentHit.value;
    }

    return undefined;
  },

  /**
   * Set a value in cache with namespace-appropriate TTL
   */
  set<T>(namespace: CacheNamespace, key: string, value: T, customTTL?: number): boolean {
    const fullKey = buildKey(namespace, key);
    const ttl = customTTL ?? getTTLForNamespace(namespace);
    const memoryStored = cache.set(fullKey, value, ttl);
    persistentCache.set(namespace, key, value, ttl);
    return memoryStored;
  },

  /**
   * Check if a key exists in cache
   */
  has(namespace: CacheNamespace, key: string): boolean {
    const fullKey = buildKey(namespace, key);
    return cache.has(fullKey) || persistentCache.has(namespace, key);
  },

  /**
   * Delete a specific key from cache
   */
  del(namespace: CacheNamespace, key: string): number {
    const fullKey = buildKey(namespace, key);
    const deletedFromMemory = cache.del(fullKey);
    const deletedFromPersistent = persistentCache.del(namespace, key);
    return deletedFromMemory + deletedFromPersistent;
  },

  /**
   * Clear all entries in a namespace
   */
  clearNamespace(namespace: CacheNamespace): void {
    const keys = cache.keys();
    const prefix = `${namespace}:`;
    const toDelete = keys.filter(k => k.startsWith(prefix));
    let deletedMemory = 0;
    if (toDelete.length > 0) {
      deletedMemory = cache.del(toDelete);
    }
    const deletedPersistent = persistentCache.clearNamespace(namespace);
    console.debug(`[Cache] Cleared namespace '${namespace}' (memory=${deletedMemory}, persistent=${deletedPersistent})`);
  },

  /**
   * Clear entire cache
   */
  clearAll(): void {
    cache.flushAll();
    const deletedPersistent = persistentCache.clearAll();
    console.debug(`[Cache] Flushed all cache entries (persistent deleted=${deletedPersistent})`);
  },

  /**
   * Get cache statistics
   */
  getStats(): { hits: number; misses: number; keys: number; size: number; persistentKeys: number } {
    const stats = cache.getStats();
    return {
      hits: stats.hits,
      misses: stats.misses,
      keys: cache.keys().length,
      size: stats.ksize + stats.vsize,
      persistentKeys: persistentCache.countActiveKeys(),
    };
  },

  /**
   * Get or set pattern - fetch from cache or compute and cache.
   *
   * Stampede prevention: if a fetch for `key` is already in progress, the
   * caller awaits the existing promise rather than starting a second fetcher.
   * This is safe for Node.js's single-threaded event loop.
   */
  async getOrSet<T>(
    namespace: CacheNamespace,
    key: string,
    fetcher: () => Promise<T>,
    customTTL?: number
  ): Promise<T> {
    const cached = this.get<T>(namespace, key);
    if (cached !== undefined) {
      return cached;
    }

    const fullKey = buildKey(namespace, key);

    // Join an existing in-flight fetch for this key rather than duplicating it
    const existing = inFlight.get(fullKey);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = fetcher()
      .then(value => {
        this.set(namespace, key, value, customTTL);
        inFlight.delete(fullKey);
        return value;
      })
      .catch(err => {
        inFlight.delete(fullKey);
        throw err;
      });

    inFlight.set(fullKey, promise);
    return promise;
  },
};

// Export for backwards compatibility with jellyseerr.ts
export const jellyseerrCache = {
  get: <T>(key: string): T | undefined => CacheService.get<T>('jellyseerr', key),
  set: <T>(key: string, value: T): boolean => CacheService.set('jellyseerr', key, value),
};

// Export for recommendations buffer
export const recommendationBuffer = {
  get: (key: string): unknown[] | undefined => CacheService.get<unknown[]>('recommendations', key),
  set: (key: string, value: unknown[]): boolean => CacheService.set('recommendations', key, value),
  clear: (): void => CacheService.clearNamespace('recommendations'),
};

export default CacheService;
