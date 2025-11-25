import { PrismaClient } from '@prisma/client';
import { sanitizeConfigUrl } from '../utils/ssrf-protection';

const prisma = new PrismaClient();

export type SystemConfig = {
  jellyfinUrl?: string | null;
  jellyseerrUrl?: string | null;
  jellyseerrApiKey?: string | null;
  geminiApiKey?: string | null;
  geminiModel?: string | null;
  isConfigured?: boolean;
};

class ConfigService {
  // Return config, prioritizing database values when isConfigured is true
  public static async getConfig(): Promise<SystemConfig> {
    // Read DB row (singleton id=1)
    let dbConfig: any = null;
    try {
      dbConfig = await prisma.systemConfig.findUnique({ where: { id: 1 } });
    } catch (e) {
      // If table doesn't exist yet or DB not ready, ignore and fall back to envs
    }

    // CRITICAL FIX: If database is marked as configured, ALWAYS prefer DB values
    // over environment variables. This ensures UI changes persist and take effect.
    // Only fall back to env vars if DB value is null/empty OR system not configured yet.
    const isDbConfigured = Boolean(dbConfig && dbConfig.isConfigured);
    
    const config: SystemConfig = {
      jellyfinUrl: isDbConfigured && dbConfig.jellyfinUrl 
        ? dbConfig.jellyfinUrl 
        : (dbConfig?.jellyfinUrl || process.env.JELLYFIN_URL || null),
      jellyseerrUrl: isDbConfigured && dbConfig.jellyseerrUrl 
        ? dbConfig.jellyseerrUrl 
        : (dbConfig?.jellyseerrUrl || process.env.JELLYSEERR_URL || null),
      jellyseerrApiKey: isDbConfigured && dbConfig.jellyseerrApiKey 
        ? dbConfig.jellyseerrApiKey 
        : (dbConfig?.jellyseerrApiKey || process.env.JELLYSEERR_API_KEY || null),
      geminiApiKey: isDbConfigured && dbConfig.geminiApiKey 
        ? dbConfig.geminiApiKey 
        : (dbConfig?.geminiApiKey || process.env.GEMINI_API_KEY || null),
      geminiModel: isDbConfigured && dbConfig.geminiModel 
        ? dbConfig.geminiModel 
        : (dbConfig?.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'),
      // CRITICAL: only consider the system configured when the DB row explicitly
      // marks `isConfigured` true. Presence of environment variables should NOT
      // cause the application to treat the system as configured — the Setup
      // Wizard must always be shown until the DB is explicitly marked configured.
      isConfigured: isDbConfigured,
    };

    return config;
  }

  public static async saveConfig(payload: Partial<SystemConfig>) {
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
    
    // Upsert singleton row with id=1
    const data: any = {
      jellyfinUrl: validatedJellyfinUrl ?? undefined,
      jellyseerrUrl: validatedJellyseerrUrl ?? undefined,
      jellyseerrApiKey: payload.jellyseerrApiKey ?? undefined,
      geminiApiKey: payload.geminiApiKey ?? undefined,
      geminiModel: payload.geminiModel ?? undefined,
      isConfigured: true,
    };

    const result = await prisma.systemConfig.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });

    // If a Gemini API key was provided, log a masked confirmation so operators
    // can see that a key was saved without exposing the secret in logs.
    try {
      const savedKey = (payload && payload.geminiApiKey) ? String(payload.geminiApiKey) : (result && result.geminiApiKey ? String(result.geminiApiKey) : null);
      if (savedKey) {
        // Never log API keys (even masked) to prevent timing attacks and log analysis
        console.info('SystemConfig: Gemini API key saved — will be used at runtime.');
      }
    } catch (e) {
      // Never throw because of logging; best-effort only
      console.warn('Failed to emit masked Gemini save log', e);
    }

    return result;
  }
}

export default ConfigService;
