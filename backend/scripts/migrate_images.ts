#!/usr/bin/env ts-node

/**
 * migrate_images.ts
 * 
 * Migration script to download and cache all external images from the database
 * 
 * Purpose:
 * - Fix broken image links when Jellyseerr IP changes
 * - Download all poster and backdrop images to local storage
 * - Update database with local /images/ paths
 * - Retry failed downloads by fetching fresh URLs from Jellyseerr
 * 
 * Usage:
 *   npm run db:migrate-images
 *   or: ts-node backend/scripts/migrate_images.ts
 */

import prisma from '../src/db';
import { ImageService } from '../src/services/image';
import { searchAndVerify } from '../src/services/jellyseerr';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

interface MigrationStats {
    total: number;
    posterSuccess: number;
    posterFailed: number;
    backdropSuccess: number;
    backdropFailed: number;
    skipped: number;
}

async function migrateImages() {
    console.log('='.repeat(60));
    console.log('IMAGE MIGRATION SCRIPT');
    console.log('='.repeat(60));
    console.log('Purpose: Download external images to local storage');
    console.log('Target: All media entries with http:// or /api/proxy URLs');
    console.log('='.repeat(60));

    const stats: MigrationStats = {
        total: 0,
        posterSuccess: 0,
        posterFailed: 0,
        backdropSuccess: 0,
        backdropFailed: 0,
        skipped: 0,
    };

    try {
        // Ensure image directory exists
        await ImageService.ensureImageDir();

        // Fetch all media from database
        const allMedia = await prisma.media.findMany({
            orderBy: { id: 'asc' },
        });

        stats.total = allMedia.length;
        console.log(`\nFound ${stats.total} media entries to process\n`);

        for (const media of allMedia) {
            console.log(`[${media.id}/${stats.total}] Processing: ${media.title} (${media.mediaType} ${media.tmdbId})`);

            let needsUpdate = false;
            const updates: any = {};

            // Check if poster needs migration
            if (media.posterUrl) {
                const isExternal = media.posterUrl.startsWith('http') || media.posterUrl.startsWith('/api/proxy');
                const alreadyLocal = media.posterUrl.startsWith('/images/');

                if (alreadyLocal) {
                    console.log('  ✓ Poster already local');
                } else if (isExternal) {
                    console.log(`  ⬇ Downloading poster: ${media.posterUrl.substring(0, 60)}...`);

                    const filename = ImageService.getLocalFilename(media.tmdbId, media.mediaType, 'poster');
                    let localPath = await ImageService.download(media.posterUrl, filename);

                    // If download failed, try fetching fresh URL from Jellyseerr
                    if (!localPath) {
                        console.log('  ⚠ Download failed, attempting Jellyseerr lookup...');
                        try {
                            const freshData = await searchAndVerify(media.title, media.releaseYear || undefined, media.mediaType);
                            if (freshData && freshData.posterUrl) {
                                console.log('  🔄 Retrying with fresh URL from Jellyseerr...');
                                localPath = await ImageService.download(freshData.posterUrl, filename);
                            }
                        } catch (error) {
                            console.error('  ✗ Jellyseerr lookup failed:', error);
                        }
                    }

                    if (localPath) {
                        updates.posterUrl = localPath;
                        needsUpdate = true;
                        stats.posterSuccess++;
                        console.log(`  ✓ Poster saved: ${localPath}`);
                    } else {
                        stats.posterFailed++;
                        console.log('  ✗ Poster download failed');
                    }
                }
            }

            // Check if backdrop needs migration
            if (media.backdropUrl) {
                const isExternal = media.backdropUrl.startsWith('http') || media.backdropUrl.startsWith('/api/proxy');
                const alreadyLocal = media.backdropUrl.startsWith('/images/');

                if (alreadyLocal) {
                    console.log('  ✓ Backdrop already local');
                } else if (isExternal) {
                    console.log(`  ⬇ Downloading backdrop: ${media.backdropUrl.substring(0, 60)}...`);

                    const filename = ImageService.getLocalFilename(media.tmdbId, media.mediaType, 'backdrop');
                    let localPath = await ImageService.download(media.backdropUrl, filename);

                    // If download failed, try fetching fresh URL from Jellyseerr
                    if (!localPath) {
                        console.log('  ⚠ Download failed, attempting Jellyseerr lookup...');
                        try {
                            const freshData = await searchAndVerify(media.title, media.releaseYear || undefined, media.mediaType);
                            if (freshData && freshData.backdropUrl) {
                                console.log('  🔄 Retrying with fresh URL from Jellyseerr...');
                                localPath = await ImageService.download(freshData.backdropUrl, filename);
                            }
                        } catch (error) {
                            console.error('  ✗ Jellyseerr lookup failed:', error);
                        }
                    }

                    if (localPath) {
                        updates.backdropUrl = localPath;
                        needsUpdate = true;
                        stats.backdropSuccess++;
                        console.log(`  ✓ Backdrop saved: ${localPath}`);
                    } else {
                        stats.backdropFailed++;
                        console.log('  ✗ Backdrop download failed');
                    }
                }
            }

            // Update database if any images were downloaded
            if (needsUpdate) {
                await prisma.media.update({
                    where: { id: media.id },
                    data: updates,
                });
                console.log('  ✓ Database updated with local paths');
            } else {
                stats.skipped++;
            }

            console.log(''); // Empty line for readability
        }

        // Print summary
        console.log('='.repeat(60));
        console.log('MIGRATION COMPLETE');
        console.log('='.repeat(60));
        console.log(`Total media entries:    ${stats.total}`);
        console.log(`Posters downloaded:     ${stats.posterSuccess}`);
        console.log(`Posters failed:         ${stats.posterFailed}`);
        console.log(`Backdrops downloaded:   ${stats.backdropSuccess}`);
        console.log(`Backdrops failed:       ${stats.backdropFailed}`);
        console.log(`Skipped (already local):${stats.skipped}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('Fatal error during migration:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Run migration
migrateImages()
    .then(() => {
        console.log('\n✓ Migration script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n✗ Migration script failed:', error);
        process.exit(1);
    });
