import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import apiRouter from './routes/api';
import authRouter from './routes/auth'; // Import new auth router
import { runMetadataBackfill } from './services/metadataBackfill';
import cron from 'node-cron';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Allow frontend on any localhost port for development flexibility
const allowedOrigins = ['http://localhost:5173', 'http://localhost:5174'];
app.use(cors({ 
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, allow any localhost port
    if (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost:')) {
      return callback(null, true);
    }
    
    // In production, check whitelist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    return callback(new Error('Not allowed by CORS'));
  }, 
  credentials: true 
}));
app.use(express.json({ limit: '50mb' })); // Increased limit for large backup imports

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

