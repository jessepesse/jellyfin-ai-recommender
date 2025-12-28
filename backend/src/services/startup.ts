/**
 * Startup initialization for recommendations
 * Generates Weekly Picks and Redemption Candidates for active users
 */

import prisma from '../db';
import { WeeklyWatchlistService } from './weekly-watchlist';
import { AdvocateService } from './advocate';
import { logger } from '../utils/logger';
import { getEnv } from '../utils/env';
import { hashPassword } from '../utils/password';

/**
 * Ensures a system admin exists in the database.
 * If not, creates one using INITIAL_ADMIN_PASSWORD.
 */
export async function bootstrapAdmin(): Promise<void> {
    try {
        const adminExists = await prisma.user.findFirst({
            where: { isSystemAdmin: true }
        });

        if (!adminExists) {
            const password = getEnv().INITIAL_ADMIN_PASSWORD;
            // Create default admin
            await prisma.user.create({
                data: {
                    username: 'admin',
                    isSystemAdmin: true,
                    passwordHash: hashPassword(password),
                    // No profile data needed for system admin
                }
            });
            logger.warn('='.repeat(60));
            logger.warn(`⚠️  SECURITY: System Admin created - Username: admin, Password: ${password}`);
            logger.warn('⚠️  IMPORTANT: Change this password IMMEDIATELY in Settings > Admin Account!');
            logger.warn('⚠️  This password is only shown once in logs.');
            logger.warn('='.repeat(60));
        }
    } catch (error) {
        logger.error({ err: error }, '[Startup] Failed to bootstrap admin user');
    }
}

/**
 * Initialize recommendations for active users at startup
 * Active = users with activity in the last 7 days
 */
export async function initializeRecommendations(): Promise<void> {
    logger.info('[Startup] Initializing recommendations for active users...');

    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // Find users with recent activity (watched, added to watchlist, or blocked something)
        const activeUsers = await prisma.user.findMany({
            where: {
                userMedia: {
                    some: {
                        updatedAt: { gte: sevenDaysAgo }
                    }
                }
            },
            select: { id: true, username: true }
        });

        if (activeUsers.length === 0) {
            logger.info('[Startup] No active users found, skipping recommendation initialization');
            return;
        }

        logger.info(`[Startup] Found ${activeUsers.length} active user(s), generating recommendations...`);

        for (const user of activeUsers) {
            try {
                // Generate Weekly Picks (will check if already exists and is fresh)
                logger.info(`[Startup] Checking Weekly Picks for user ${user.username} (${user.id})`);
                await WeeklyWatchlistService.getForUser(user.id);

                // Generate Redemption Candidates only if user has blocked items
                const blockedCount = await prisma.userMedia.count({
                    where: {
                        userId: user.id,
                        status: 'BLOCKED',
                        permanentBlock: false
                    }
                });

                if (blockedCount > 0) {
                    logger.info(`[Startup] Checking Redemption Candidates for user ${user.username} (${user.id}), ${blockedCount} blocked items`);
                    await AdvocateService.getRedemptionCandidates(user.id);
                } else {
                    logger.info(`[Startup] Skipping Redemption Candidates for user ${user.username} (${user.id}), no blocked items`);
                }
            } catch (error) {
                logger.error({ err: error, userId: user.id }, `[Startup] Failed to initialize recommendations for user ${user.username}`);
                // Continue with next user even if one fails
            }
        }

        logger.info('[Startup] Recommendation initialization complete');
    } catch (error) {
        logger.error({ err: error }, '[Startup] Failed to initialize recommendations');
    }
}
