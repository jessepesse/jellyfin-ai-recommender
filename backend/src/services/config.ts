import { SystemConfig as PrismaSystemConfig } from '../generated/prisma/client';
import { sanitizeConfigUrl } from '../utils/ssrf-protection';
import prisma from '../db';

export type SystemConfig = {
  jellyfinUrl?: string | null;
  jellyseerrUrl?: string | null;
  jellyseerrApiKey?: string | null;
  tmdbApiKey?: string | null;
  geminiApiKey?: string | null;
  geminiModel?: string | null;
  isConfigured?: boolean;
};

// Config update payload type
export type ConfigUpdatePayload = Partial<Omit<SystemConfig, 'isConfigured'>>;

// Cache for config to reduce database queries
let configCache: SystemConfig | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds cache TTL

class ConfigService {
  /**
   * Clear the config cache (call after updates)
   */
  public static clearCache(): void {
    configCache = null;
    cacheTimestamp = 0;
  }

  /**
   * Return config, prioritizing database values when isConfigured is true
   * Uses in-memory caching to reduce database load
   */
  public static async getConfig(): Promise<SystemConfig> {
    // Return cached config if still valid
    const now = Date.now();
    if (configCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
      return configCache;
    }

    // Read DB row (singleton id=1)
    let dbConfig: PrismaSystemConfig | null = null;
    try {
      dbConfig = await prisma.systemConfig.findUnique({ where: { id: 1 } });
    } catch (e) {
      // If table doesn't exist yet or DB not ready, ignore and fall back to envs
      console.warn('[ConfigService] Failed to read config from DB, using env fallback');
    }

    // CRITICAL FIX: If database is marked as configured, ALWAYS prefer DB values
    // over environment variables. This ensures UI changes persist and take effect.
    // Only fall back to env vars if DB value is null/empty OR system not configured yet.
    const isDbConfigured = Boolean(dbConfig && dbConfig.isConfigured);

    const config: SystemConfig = {
      jellyfinUrl: isDbConfigured && dbConfig?.jellyfinUrl
        ? dbConfig.jellyfinUrl
        : (dbConfig?.jellyfinUrl || process.env.JELLYFIN_URL || null),
      jellyseerrUrl: isDbConfigured && dbConfig?.jellyseerrUrl
        ? dbConfig.jellyseerrUrl
        : (dbConfig?.jellyseerrUrl || process.env.JELLYSEERR_URL || null),
      jellyseerrApiKey: isDbConfigured && dbConfig?.jellyseerrApiKey
        ? dbConfig.jellyseerrApiKey
        : (dbConfig?.jellyseerrApiKey || process.env.JELLYSEERR_API_KEY || null),
      tmdbApiKey: isDbConfigured && dbConfig?.tmdbApiKey
        ? dbConfig.tmdbApiKey
        : (dbConfig?.tmdbApiKey || process.env.TMDB_API_KEY || null),
      geminiApiKey: isDbConfigured && dbConfig?.geminiApiKey
        ? dbConfig.geminiApiKey
        : (dbConfig?.geminiApiKey || process.env.GEMINI_API_KEY || null),
      geminiModel: isDbConfigured && dbConfig?.geminiModel
        ? dbConfig.geminiModel
        : (dbConfig?.geminiModel || process.env.GEMINI_MODEL || 'gemini-3-flash-preview'),
      // CRITICAL: only consider the system configured when the DB row explicitly
      // marks `isConfigured` true. Presence of environment variables should NOT
      // cause the application to treat the system as configured — the Setup
      // Wizard must always be shown until the DB is explicitly marked configured.
      isConfigured: isDbConfigured,
    };

    // Update cache
    configCache = config;
    cacheTimestamp = now;

    return config;
  }

  public static async saveConfig(payload: ConfigUpdatePayload): Promise<PrismaSystemConfig> {
    // SSRF Protection: Validate URLs before saving to database (permissive for user config)
    const validatedJellyfinUrl = payload.jellyfinUrl ? sanitizeConfigUrl(payload.jellyfinUrl) : undefined;
    const validatedJellyseerrUrl = payload.jellyseerrUrl ? sanitizeConfigUrl(payload.jellyseerrUrl) : undefined;

    // Throw error if URL validation fails with detailed message
    if (payload.jellyfinUrl && !validatedJellyfinUrl) {
      console.error(`[ConfigService] Jellyfin URL validation failed for: ${payload.jellyfinUrl}`);
      throw new Error(`Invalid or blocked Jellyfin URL: ${payload.jellyfinUrl}. Ensure it uses http:// or https:// protocol.`);
    }
    if (payload.jellyseerrUrl && !validatedJellyseerrUrl) {
      console.error(`[ConfigService] Jellyseerr URL validation failed for: ${payload.jellyseerrUrl}`);
      throw new Error(`Invalid or blocked Jellyseerr URL: ${payload.jellyseerrUrl}. Ensure it uses http:// or https:// protocol.`);
    }

    // Build update data with proper typing
    interface ConfigUpsertData {
      jellyfinUrl?: string;
      jellyseerrUrl?: string;
      jellyseerrApiKey?: string;
      tmdbApiKey?: string;
      geminiApiKey?: string;
      geminiModel?: string;
      isConfigured: boolean;
    }

    const data: ConfigUpsertData = {
      isConfigured: true,
    };

    if (validatedJellyfinUrl) data.jellyfinUrl = validatedJellyfinUrl;
    if (validatedJellyseerrUrl) data.jellyseerrUrl = validatedJellyseerrUrl;
    if (payload.jellyseerrApiKey) data.jellyseerrApiKey = payload.jellyseerrApiKey;
    if (payload.tmdbApiKey) data.tmdbApiKey = payload.tmdbApiKey;
    if (payload.geminiApiKey) data.geminiApiKey = payload.geminiApiKey;
    if (payload.geminiModel) data.geminiModel = payload.geminiModel;

    const result = await prisma.systemConfig.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });

    // Clear cache after saving new config
    this.clearCache();

    // If a Gemini API key was provided, log a confirmation
    if (payload.geminiApiKey || result.geminiApiKey) {
      console.info('SystemConfig: Gemini API key saved — will be used at runtime.');
    }

    // If a TMDB API key was provided, log a confirmation
    if (payload.tmdbApiKey || result.tmdbApiKey) {
      console.info('SystemConfig: TMDB API key saved — will be used for direct discovery.');
    }

    return result;
  }
}

export default ConfigService;
