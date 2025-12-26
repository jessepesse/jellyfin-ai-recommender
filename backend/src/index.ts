import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Load environment variables first
dotenv.config();

// Validate environment configuration
import { validateEnv, getEnv } from './utils/env';
validateEnv();
import { logger } from './utils/logger';

import apiRouter from './routes/api';
import authRouter from './routes/auth'; // Import new auth router
import statsRouter from './routes/stats';
import weeklyWatchlistRouter from './routes/weekly-watchlist';
import blockedRouter from './routes/blocked';
import adminRouter from './routes/admin';
import { runMetadataBackfill } from './services/metadataBackfill';
import { runEnrichmentBackfill } from './services/enrichment';
import { initScheduler, checkStaleWatchlists } from './services/scheduler';
import { initializeRecommendations } from './services/startup';
import { errorHandler } from './utils/errors';
import cron from 'node-cron';
import swaggerUi from 'swagger-ui-express';
import { specs } from './config/swagger';

const app = express();
const env = getEnv();
const port = env.PORT;

// Trust proxy headers for rate limiting (needed for reverse proxies like Nginx, ZimaOS)
// This allows express-rate-limit to correctly identify users behind proxies
app.set('trust proxy', 1);

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for React
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"], // Allow images from HTTPS sources
      connectSrc: ["'self'", "http://localhost:*"], // Allow API calls in dev
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding in iframes if needed
}));

// CORS configuration: Strict allowlist for self-hosted deployment
// Allows private networks (LAN), localhost, and configured origins only
const allowedOrigins = [process.env.CORS_ORIGIN].filter(Boolean);

// Regex for Private IP ranges (RFC 1918) + Localhost
const privateIpRegex = /^(http|https):\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

app.use(cors({
  origin: function (origin, callback) {
    // 1. Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // 2. Allow specific env override
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // 3. Allow Private Networks & Localhost
    if (privateIpRegex.test(origin)) {
      return callback(null, true);
    }

    // 4. Block external public domains
    const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
    return callback(new Error(msg), false);
  },
  credentials: true
}));

// Rate limiting
// Balanced approach: Protect against abuse while allowing normal usage patterns
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // 2000 requests per 15 minutes (~133/min) - allows very large imports (1000+ items)
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for read-only system endpoints (status checks, config reads)
  skip: (req) => {
    const readOnlyPaths = [
      '/system/status',
      '/system/setup-defaults',
      '/system/config-editor',
      '/health',
    ];
    return readOnlyPaths.some(path => req.path.includes(path)) && req.method === 'GET';
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per 15 minutes (increased from 5 for multi-device scenarios)
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const recommendationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // 30 recommendations per 5 minutes (increased from 10 for browsing sessions)
  message: 'Too many recommendation requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Separate limiter for setup/verify operations (not import - that's handled separately)
const setupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 setup/verify calls per 5 minutes - protects against automated abuse
  message: 'Too many configuration changes, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Very permissive limiter for import operations (they're long-running and already async)
const importLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes (shorter window for faster recovery)
  max: 10, // 10 import operations per 5 minutes (allows testing and troubleshooting)
  message: 'Too many import operations, please wait a moment before importing again.',
  standardHeaders: true,
  legacyHeaders: false,
});

// CRITICAL: Parse JSON BEFORE rate limiting so limiters can access req.body if needed
app.use(express.json({ limit: '50mb' })); // Increased limit for large backup imports

// Apply rate limiters in order (most specific first)
app.use('/api/auth', authLimiter);
app.use('/api/recommendations', recommendationLimiter);
app.use('/api/system/setup', setupLimiter);
app.use('/api/system/verify', setupLimiter);
app.use('/api/settings/import', importLimiter); // Special handling for imports
app.use('/api', generalLimiter); // General limiter for all other endpoints

// Weekly Watchlist route
app.use('/api/weekly-watchlist', weeklyWatchlistRouter);

// Blocked content and redemption routes
app.use('/api/blocked', blockedRouter);

// Admin routes
app.use('/api/admin', adminRouter);

// Serve static images from local storage
// Images are downloaded and cached to prevent broken links when Jellyseerr IP changes
const imageDir = env.IMAGE_DIR;
app.use('/images', express.static(imageDir));
console.log(`[Static] Serving images from: ${imageDir}`);

// Lightweight health endpoint (no DB access) for Docker and load-balancers
/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check
 *     description: Returns the health status of the server
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 uptime:
 *                   type: number
 *                 timestamp:
 *                   type: string
 */
app.get('/api/health', (_req, res) => {
  try {
    return res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ status: 'error', error: String(e) });
  }
});

app.use('/api', apiRouter);
app.use('/api/auth', authRouter); // Mount auth router
app.use('/api/stats', statsRouter);
import trendingRouter from './routes/trending';
app.use('/api/trending', trendingRouter);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Centralized error handling middleware (must be after routes)
app.use(errorHandler);

app.listen(port, () => {
  logger.info(`Server is running on http://localhost:${port}`);
  // Run metadata backfill at startup (non-blocking)
  (async () => {
    try {
      logger.info('Triggering metadata backfill at startup...');
      await runMetadataBackfill();
      // Run enrichment backfill after metadata backfill
      logger.info('Triggering enrichment backfill at startup...');
      await runEnrichmentBackfill();
      // Initialize scheduler for weekly watchlist
      initScheduler();
      // Check for stale weekly watchlists
      logger.info('Checking for stale weekly watchlists...');
      await checkStaleWatchlists();
      // Initialize recommendations for active users
      logger.info('Initializing recommendations for active users...');
      await initializeRecommendations();
    } catch (e) {
      logger.error({ err: e }, 'Startup backfill failed');
    }
  })();

  // Schedule daily backfill at 03:00 server time
  try {
    cron.schedule('0 3 * * *', async () => {
      logger.info('Scheduled backfill triggered (daily at 03:00)');
      try {
        await runMetadataBackfill();
        await runEnrichmentBackfill();
      } catch (e) {
        logger.error({ err: e }, 'Scheduled backfill failed');
      }
    });
    logger.info('Scheduled daily backfill at 03:00');
  } catch (e) {
    logger.warn({ err: e }, 'Failed to schedule backfill');
  }
});

