import { PrismaClient } from '@prisma/client';

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
  // Return config, preferring environment variables when present
  public static async getConfig(): Promise<SystemConfig> {
    // Read DB row (singleton id=1)
    let dbConfig: any = null;
    try {
      dbConfig = await prisma.systemConfig.findUnique({ where: { id: 1 } });
    } catch (e) {
      // If table doesn't exist yet or DB not ready, ignore and fall back to envs
    }

    // Prefer values stored in the database (set via the Setup Wizard) and fall back
    // to environment variables only when a DB value is not present. This allows the
    // runtime to reflect in-app configuration without being overridden by empty or
    // stale environment values.
    const config: SystemConfig = {
      jellyfinUrl: (dbConfig && dbConfig.jellyfinUrl) ? dbConfig.jellyfinUrl : (process.env.JELLYFIN_URL || null),
      jellyseerrUrl: (dbConfig && dbConfig.jellyseerrUrl) ? dbConfig.jellyseerrUrl : (process.env.JELLYSEERR_URL || null),
      jellyseerrApiKey: (dbConfig && dbConfig.jellyseerrApiKey) ? dbConfig.jellyseerrApiKey : (process.env.JELLYSEERR_API_KEY || null),
      geminiApiKey: (dbConfig && dbConfig.geminiApiKey) ? dbConfig.geminiApiKey : (process.env.GEMINI_API_KEY || null),
      geminiModel: (dbConfig && dbConfig.geminiModel) ? dbConfig.geminiModel : (process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'),
      // CRITICAL: only consider the system configured when the DB row explicitly
      // marks `isConfigured` true. Presence of environment variables should NOT
      // cause the application to treat the system as configured — the Setup
      // Wizard must always be shown until the DB is explicitly marked configured.
      isConfigured: Boolean(dbConfig && dbConfig.isConfigured),
    };

    return config;
  }

  public static async saveConfig(payload: Partial<SystemConfig>) {
    // Upsert singleton row with id=1
    const data: any = {
      jellyfinUrl: payload.jellyfinUrl ?? undefined,
      jellyseerrUrl: payload.jellyseerrUrl ?? undefined,
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
