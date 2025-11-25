import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import apiRouter from './routes/api';
import authRouter from './routes/auth'; // Import new auth router
import { runMetadataBackfill } from './services/metadataBackfill';
import cron from 'node-cron';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

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
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes per IP
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const recommendationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 recommendation requests per 5 minutes
  message: 'Too many recommendation requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiters
app.use('/api/auth', authLimiter);
app.use('/api/recommendations', recommendationLimiter);
app.use('/api', generalLimiter); // General limiter for all other endpoints

app.use(express.json({ limit: '50mb' })); // Increased limit for large backup imports

// Serve static images from local storage
// Images are downloaded and cached to prevent broken links when Jellyseerr IP changes
const imageDir = process.env.IMAGE_DIR || '/app/images';
app.use('/images', express.static(imageDir));
console.log(`[Static] Serving images from: ${imageDir}`);

// Lightweight health endpoint (no DB access) for Docker and load-balancers
app.get('/api/health', (_req, res) => {
  try {
    return res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ status: 'error', error: String(e) });
  }
});

app.use('/api', apiRouter);
app.use('/api/auth', authRouter); // Mount auth router

app.listen(port, () => {
  console.info(`Server is running on http://localhost:${port}`);
  // Run metadata backfill at startup (non-blocking)
  (async () => {
    try {
      console.info('Triggering metadata backfill at startup...');
      await runMetadataBackfill();
    } catch (e) {
      console.error('Startup metadata backfill failed', e);
    }
  })();

  // Schedule daily backfill at 03:00 server time
  try {
    cron.schedule('0 3 * * *', async () => {
      console.info('Scheduled metadata backfill triggered (daily at 03:00)');
      try {
        await runMetadataBackfill();
      } catch (e) {
        console.error('Scheduled metadata backfill failed', e);
      }
    });
    console.info('Scheduled daily metadata backfill at 03:00');
  } catch (e) {
    console.warn('Failed to schedule metadata backfill', e);
  }
});

