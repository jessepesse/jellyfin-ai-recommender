/**
 * Download Missing Images Script
 * Downloads poster and backdrop images for all media items in database
 * that have posterSourceUrl/backdropSourceUrl but missing local files
 */

import { prisma } from '../src/db';
import { ImageService } from '../src/services/image';

async function downloadMissingImages() {
    console.log('[Download Images] Starting...');

    const allMedia = await prisma.media.findMany();
    console.log(`[Download Images] Found ${allMedia.length} media items`);

    let downloaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const media of allMedia) {
        try {
            const needsPoster = media.posterSourceUrl && !ImageService.imageExists(media.tmdbId, media.mediaType, 'poster');
            const needsBackdrop = media.backdropSourceUrl && !ImageService.imageExists(media.tmdbId, media.mediaType, 'backdrop');

            if (!needsPoster && !needsBackdrop) {
                skipped++;
                continue;
            }

            console.log(`[Download Images] Downloading for: ${media.title} (${media.tmdbId})`);

            const result = await ImageService.downloadMediaImages(
                media.tmdbId,
                media.mediaType,
                needsPoster ? media.posterSourceUrl : null,
                needsBackdrop ? media.backdropSourceUrl : null
            );

            // Update database with local paths
            const updateData: any = {};
            if (result.posterUrl && result.posterUrl !== media.posterUrl) {
                updateData.posterUrl = result.posterUrl;
            }
            if (result.backdropUrl && result.backdropUrl !== media.backdropUrl) {
                updateData.backdropUrl = result.backdropUrl;
            }

            if (Object.keys(updateData).length > 0) {
                await prisma.media.update({
                    where: { id: media.id },
                    data: updateData
                });
                downloaded++;
                console.log(`[Download Images] ✓ Downloaded and updated: ${media.title}`);
            } else {
                skipped++;
            }

            // Small delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error: any) {
            failed++;
            console.error(`[Download Images] ✗ Failed for ${media.title}:`, error?.message);
        }
    }

    console.log('[Download Images] Complete!');
    console.log(`  Downloaded: ${downloaded}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Failed: ${failed}`);

    await prisma.$disconnect();
}

downloadMissingImages().catch(console.error);
