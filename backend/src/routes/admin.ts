/**
 * Admin routes - User management and statistics
 */

import { Router } from 'express';
import prisma from '../db';
import { authMiddleware, requireAdmin } from '../middleware/auth';

const router = Router();

// Apply auth middleware to all admin routes
router.use(authMiddleware);
router.use(requireAdmin);

/**
 * GET /admin/users - Get all users with statistics
 */
router.get('/users', async (req, res) => {
    try {
        // Auth handled by middleware

        const users = await prisma.user.findMany({
            select: {
                id: true,
                username: true,
                createdAt: true,
                userMedia: {
                    select: {
                        status: true,
                        updatedAt: true
                    }
                }
            }
        });

        const userStats = await Promise.all(users.map(async (user) => {
            // Count by status
            const watched = user.userMedia.filter(um => um.status === 'WATCHED').length;
            const watchlist = user.userMedia.filter(um => um.status === 'WATCHLIST').length;
            const blocked = user.userMedia.filter(um => um.status === 'BLOCKED').length;

            // Find last activity
            const lastActivity = user.userMedia.length > 0
                ? user.userMedia.reduce((latest, um) =>
                    um.updatedAt > latest ? um.updatedAt : latest,
                    user.userMedia[0].updatedAt
                )
                : user.createdAt;

            // Get Weekly Picks status
            const weeklyPicks = await prisma.weeklyWatchlist.findFirst({
                where: { userId: user.id },
                orderBy: { generatedAt: 'desc' },
                select: { generatedAt: true }
            });

            // Get Redemption Candidates status
            const redemptionCandidates = await prisma.redemptionCandidates.findFirst({
                where: { userId: user.id },
                orderBy: { generatedAt: 'desc' },
                select: { generatedAt: true }
            });

            // Determine if active (activity in last 7 days)
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const isActive = lastActivity >= sevenDaysAgo;

            return {
                username: user.username,
                createdAt: user.createdAt,
                lastActivity,
                isActive,
                stats: {
                    watched,
                    watchlist,
                    blocked,
                    total: watched + watchlist + blocked
                },
                aiFeatures: {
                    weeklyPicks: weeklyPicks ? {
                        generatedAt: weeklyPicks.generatedAt,
                        daysOld: (Date.now() - weeklyPicks.generatedAt.getTime()) / (1000 * 60 * 60 * 24)
                    } : null,
                    redemptionCandidates: redemptionCandidates ? {
                        generatedAt: redemptionCandidates.generatedAt,
                        daysOld: (Date.now() - redemptionCandidates.generatedAt.getTime()) / (1000 * 60 * 60 * 24)
                    } : null
                }
            };
        }));

        // Sort by last activity (most recent first)
        userStats.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

        res.json({
            users: userStats,
            summary: {
                total: users.length,
                active: userStats.filter(u => u.isActive).length,
                inactive: userStats.filter(u => !u.isActive).length
            }
        });
    } catch (e) {
        console.error('Failed to fetch user statistics', e);
        res.status(500).json({ error: 'Failed to fetch user statistics' });
    }
});

export default router;
