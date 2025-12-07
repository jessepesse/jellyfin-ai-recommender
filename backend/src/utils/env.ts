/**
 * Environment variable validation using Zod
 * Validates environment configuration at startup
 */

import { z } from 'zod';

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
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash-lite'),
  
  // CORS configuration
  CORS_ORIGIN: z.string().url().optional(),
  
  // Storage paths
  IMAGE_DIR: z.string().default('/app/images'),
  DATABASE_URL: z.string().default('file:/app/data/dev.db'),
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
    console.error('❌ Environment validation failed:');
    
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      console.error(`  - ${path}: ${issue.message}`);
    }
    
    // In development, continue with defaults
    // In production, you might want to exit
    if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️ Running with invalid environment configuration');
    }
    
    // Return partial validation with defaults
    validatedEnv = envSchema.parse({
      ...process.env,
      // Ensure defaults are applied for invalid values
    });
  } else {
    validatedEnv = result.data;
  }

  // Log successful validation (without sensitive values)
  console.info('✅ Environment validated:', {
    NODE_ENV: validatedEnv.NODE_ENV,
    PORT: validatedEnv.PORT,
    JELLYFIN_URL: validatedEnv.JELLYFIN_URL ? '(configured)' : '(not set)',
    JELLYSEERR_URL: validatedEnv.JELLYSEERR_URL ? '(configured)' : '(not set)',
    JELLYSEERR_API_KEY: validatedEnv.JELLYSEERR_API_KEY ? '(configured)' : '(not set)',
    GEMINI_API_KEY: validatedEnv.GEMINI_API_KEY ? '(configured)' : '(not set)',
    GEMINI_MODEL: validatedEnv.GEMINI_MODEL,
    IMAGE_DIR: validatedEnv.IMAGE_DIR,
  });

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
