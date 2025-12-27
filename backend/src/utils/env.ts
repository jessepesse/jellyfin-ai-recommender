/**
 * Environment variable validation using Zod
 * Validates environment configuration at startup
 */

import { z } from 'zod';
import { logger } from './logger';

/**
 * Schema for environment variables
 * All variables are optional since they can be configured via UI
 */
const envSchema = z.object({
  // Server configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.string().regex(/^\d+$/).transform(Number).default(3001),

  // External service URLs (validated as URLs when present)
  JELLYFIN_URL: z.string().url().optional(),
  JELLYSEERR_URL: z.string().url().optional(),

  // API keys (non-empty strings when present)
  JELLYSEERR_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-3-flash-preview'),

  // CORS configuration
  CORS_ORIGIN: z.string().url().optional(),

  // Storage paths
  IMAGE_DIR: z.string().default('/app/images'),
  DATABASE_URL: z.string().default('file:/app/data/dev.db'),
  INITIAL_ADMIN_PASSWORD: z.string().default('admin123'),
});

// Type inference from schema
export type Env = z.infer<typeof envSchema>;

/**
 * Validated environment variables
 * Will throw at startup if required variables are invalid
 */
let validatedEnv: Env | null = null;

/**
 * Validate environment variables
 * Call this at application startup
 */
export function validateEnv(): Env {
  if (validatedEnv) {
    return validatedEnv;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    logger.error('❌ Environment validation failed:');

    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      logger.error(`  - ${path}: ${issue.message}`);
    }

    // In production, exit on invalid configuration to prevent undefined behavior
    if (process.env.NODE_ENV === 'production') {
      logger.fatal('⚠️ Exiting due to invalid environment configuration');
      process.exit(1);
    }

    // In development, we try to proceed but warn heavily
    logger.warn('⚠️ Running with invalid environment configuration (falling back to defaults where possible)');

    // We attempt to re-parse ignoring the specific valid fields? 
    // Actually, letting it throw or using a stripped object is safer.
    // For now, we'll try to use the raw env and hope schemas defaults kick in for missing ones,
    // but invalid values will still cause issues.
    // Better to return a partial default object if possible, or just throw.
    // Let's rely on the crash if it's critical.
    throw new Error('Environment validation failed');
  } else {
    validatedEnv = result.data;
  }

  // Log successful validation (without sensitive values)
  logger.info({
    NODE_ENV: validatedEnv.NODE_ENV,
    PORT: validatedEnv.PORT,
    JELLYFIN_URL: validatedEnv.JELLYFIN_URL ? '(configured)' : '(not set)',
    JELLYSEERR_URL: validatedEnv.JELLYSEERR_URL ? '(configured)' : '(not set)',
    JELLYSEERR_API_KEY: validatedEnv.JELLYSEERR_API_KEY ? '(configured)' : '(not set)',
    GEMINI_API_KEY: validatedEnv.GEMINI_API_KEY ? '(configured)' : '(not set)',
    GEMINI_MODEL: validatedEnv.GEMINI_MODEL,
    IMAGE_DIR: validatedEnv.IMAGE_DIR,
  }, '✅ Environment validated');

  return validatedEnv;
}

/**
 * Get validated environment (throws if not validated yet)
 */
export function getEnv(): Env {
  if (!validatedEnv) {
    return validateEnv();
  }
  return validatedEnv;
}

/**
 * Check if a specific service is configured via environment
 */
export const envConfig = {
  hasJellyfin: () => Boolean(getEnv().JELLYFIN_URL),
  hasJellyseerr: () => Boolean(getEnv().JELLYSEERR_URL),
  hasGemini: () => Boolean(getEnv().GEMINI_API_KEY),
  isDevelopment: () => getEnv().NODE_ENV === 'development',
  isProduction: () => getEnv().NODE_ENV === 'production',
};
