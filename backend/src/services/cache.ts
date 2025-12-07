/**
 * Unified caching service for the application
 * Provides consistent caching with TTL support for different data types
 */

import NodeCache from 'node-cache';

// Cache configuration
const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour default
const RECOMMENDATION_TTL_SECONDS = 60 * 30; // 30 minutes for recommendations
const CONFIG_TTL_SECONDS = 30; // 30 seconds for config (matches ConfigService)
const JELLYSEERR_TTL_SECONDS = 60 * 60 * 12; // 12 hours for Jellyseerr data

// Cache namespaces
export type CacheNamespace = 
  | 'recommendations'
  | 'jellyseerr'
  | 'config'
  | 'taste'
  | 'general';

// Internal cache instance
const cache = new NodeCache({
  stdTTL: DEFAULT_TTL_SECONDS,
  checkperiod: 120, // Check for expired keys every 2 minutes
  useClones: false, // Return references for better performance
});

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
    return cache.get<T>(fullKey);
  },

  /**
   * Set a value in cache with namespace-appropriate TTL
   */
  set<T>(namespace: CacheNamespace, key: string, value: T, customTTL?: number): boolean {
    const fullKey = buildKey(namespace, key);
    const ttl = customTTL ?? getTTLForNamespace(namespace);
    return cache.set(fullKey, value, ttl);
  },

  /**
   * Check if a key exists in cache
   */
  has(namespace: CacheNamespace, key: string): boolean {
    const fullKey = buildKey(namespace, key);
    return cache.has(fullKey);
  },

  /**
   * Delete a specific key from cache
   */
  del(namespace: CacheNamespace, key: string): number {
    const fullKey = buildKey(namespace, key);
    return cache.del(fullKey);
  },

  /**
   * Clear all entries in a namespace
   */
  clearNamespace(namespace: CacheNamespace): void {
    const keys = cache.keys();
    const prefix = `${namespace}:`;
    const toDelete = keys.filter(k => k.startsWith(prefix));
    if (toDelete.length > 0) {
      cache.del(toDelete);
      console.debug(`[Cache] Cleared ${toDelete.length} entries from namespace '${namespace}'`);
    }
  },

  /**
   * Clear entire cache
   */
  clearAll(): void {
    cache.flushAll();
    console.debug('[Cache] Flushed all cache entries');
  },

  /**
   * Get cache statistics
   */
  getStats(): { hits: number; misses: number; keys: number; size: number } {
    const stats = cache.getStats();
    return {
      hits: stats.hits,
      misses: stats.misses,
      keys: cache.keys().length,
      size: stats.ksize + stats.vsize,
    };
  },

  /**
   * Get or set pattern - fetch from cache or compute and cache
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

    const value = await fetcher();
    this.set(namespace, key, value, customTTL);
    return value;
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
