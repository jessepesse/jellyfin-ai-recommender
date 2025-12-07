/**
 * API Routes - Main router that combines all route modules
 * 
 * Route structure:
 * - /api/proxy/image, /api/system/* - System configuration & image proxy
 * - /api/search, /api/recommendations - AI recommendations
 * - /api/actions/*, /api/jellyseerr/* - User actions
 * - /api/libraries, /api/items, /api/user/* - User data
 * - /api/settings/* - Import/Export
 * - /api/sync/* - Jellyfin sync
 * - /api/images/*, /api/debug/* - Media files
 */

import { Router } from 'express';

// Import route modules
import systemRoutes from './system';
import recommendationsRoutes from './recommendations';
import actionsRoutes from './actions';
import userRoutes from './user';
import settingsRoutes from './settings';
import syncRoutes from './sync';
import mediaRoutes from './media';

const router = Router();

// Mount route modules with appropriate prefixes
// System routes: /proxy/image, /system/*
router.use('/', systemRoutes);
router.use('/system', systemRoutes);

// Recommendations routes: /search, /recommendations
router.use('/', recommendationsRoutes);

// Actions routes: /actions/*, /jellyseerr/*
router.use('/actions', actionsRoutes);
router.use('/jellyseerr', actionsRoutes);

// User routes: /libraries, /items, /user/*
router.use('/', userRoutes);
router.use('/user', userRoutes);

// Settings routes: /settings/*
router.use('/settings', settingsRoutes);

// Sync routes: /sync/*
router.use('/sync', syncRoutes);

// Media routes: /images/*, /debug/*
router.use('/', mediaRoutes);
router.use('/debug', mediaRoutes);

export default router;
