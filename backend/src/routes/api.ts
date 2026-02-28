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
import systemRoutes, { proxyRouter } from './system';
import recommendationsRoutes from './recommendations';
import actionsRoutes from './actions';
import userRoutes from './user';
import settingsRoutes from './settings';
import syncRoutes from './sync';
import mediaRoutes from './media';

const router = Router();

// Mount route modules with exactly one canonical path each.
//
// Previously systemRoutes and mediaRoutes were mounted twice (at '/' and at their
// named prefix), which created alias paths like /api/setup and /api/verify that
// bypassed the /api/system/setup and /api/system/verify rate limiters in index.ts.
//
// The image-proxy handler has been extracted into proxyRouter so it can be served
// at /api/proxy/image without dragging the rest of systemRoutes along.

// Image proxy: /api/proxy/image  (separate from system-management routes)
router.use('/proxy', proxyRouter);

// System management: /api/system/*
router.use('/system', systemRoutes);

// Recommendations: /api/search, /api/recommendations
router.use('/', recommendationsRoutes);

// Actions: /api/actions/*  (Jellyseerr requests go through /api/jellyseerr/*)
router.use('/actions', actionsRoutes);
router.use('/jellyseerr', actionsRoutes);

// User data: /api/libraries, /api/items, /api/user/*
router.use('/', userRoutes);

// Settings: /api/settings/*
router.use('/settings', settingsRoutes);

// Sync: /api/sync/*
router.use('/sync', syncRoutes);

// Media: /api/images/:filename, /api/debug/*
router.use('/', mediaRoutes);

export default router;
