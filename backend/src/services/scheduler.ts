/**
 * Scheduler Service
 * Handles periodic tasks including weekly watchlist generation
 */

import cron from 'node-cron';
import { WeeklyWatchlistService } from './weekly-watchlist';

// Track initialization to prevent duplicate schedulers
let isSchedulerInitialized = false;

/**
 * Initialize all scheduled tasks
 * Should be called once during application startup
 */
export function initScheduler(): void {
    if (isSchedulerInitialized) {
        console.warn('[Scheduler] Already initialized, skipping');
        return;
    }

    // Weekly Watchlist Generation
    // Runs every Monday at 03:00
    // Cron format: minute hour day-of-month month day-of-week
    cron.schedule('0 3 * * 1', async () => {
        console.log('[Scheduler] Starting weekly watchlist generation');
        try {
            await WeeklyWatchlistService.generateForAllUsers();
            console.log('[Scheduler] Weekly watchlist generation completed');
        } catch (error: any) {
            console.error('[Scheduler] Weekly watchlist generation failed:', error?.message || error);
        }
    }, {
        timezone: 'Europe/Helsinki' // Adjust to server timezone
    });

    isSchedulerInitialized = true;
    console.log('[Scheduler] Initialized - Weekly watchlist generation scheduled for Mondays at 03:00');
}

/**
 * Check for stale weekly watchlists and regenerate
 * Called during application startup
 */
export async function checkStaleWatchlists(): Promise<void> {
    console.log('[Scheduler] Checking for stale weekly watchlists...');
    try {
        await WeeklyWatchlistService.checkAndRefreshStale();
        console.log('[Scheduler] Stale watchlist check completed');
    } catch (error: any) {
        console.error('[Scheduler] Stale watchlist check failed:', error?.message || error);
    }
}

/**
 * Manually trigger watchlist generation for all users
 * Useful for testing or manual refresh
 */
export async function triggerWatchlistGeneration(): Promise<void> {
    console.log('[Scheduler] Manually triggering watchlist generation');
    await WeeklyWatchlistService.generateForAllUsers();
}
