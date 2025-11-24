import prisma from './data';
import { searchAndEnrich } from './jellyseerr';

async function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function runMetadataBackfill() {
  console.info('Starting metadata backfill (service)...');
  const medias = await prisma.media.findMany() as any[];
  console.info(`Found ${medias.length} media rows to inspect`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const m of medias) {
    try {
      const needsOverview = !m.overview || String(m.overview).trim() === '';
      const needsBackdrop = !m.backdropUrl || String(m.backdropUrl).trim() === '';
      const needsVote = (m.voteAverage === null || m.voteAverage === undefined);
      if (!needsOverview && !needsBackdrop && !needsVote) {
        skipped++;
        continue;
      }

      const title = m.title || '';
      const mediaType = (m.mediaType || 'movie') as any;
      const year = m.releaseYear || undefined;

      if (!title) {
        console.warn(`Skipping media id=${m.id} tmdbId=${m.tmdbId} because title is missing`);
        skipped++;
        continue;
      }

      const enriched = await searchAndEnrich(title, mediaType, year);
      if (!enriched) {
        console.debug(`No enrichment found for: ${title} (${year || 'n/a'})`);
        skipped++;
        await sleep(150);
        continue;
      }

      const toUpdate: any = {};
      if (needsOverview && enriched.overview) toUpdate.overview = enriched.overview;
      if (needsBackdrop && enriched.backdropUrl) toUpdate.backdropUrl = enriched.backdropUrl;
      if (needsVote && enriched.voteAverage !== undefined && enriched.voteAverage !== null) toUpdate.voteAverage = Number(enriched.voteAverage);
      if ((!m.posterUrl || m.posterUrl === null) && enriched.posterUrl) toUpdate.posterUrl = enriched.posterUrl;
      if ((!m.language || m.language === null) && enriched.language) toUpdate.language = String(enriched.language);

      if (Object.keys(toUpdate).length === 0) {
        skipped++;
        await sleep(150);
        continue;
      }

      await prisma.media.update({ where: { id: m.id }, data: toUpdate });
      console.info(`Updated media id=${m.id} tmdbId=${m.tmdbId} -> ${Object.keys(toUpdate).join(',')}`);
      updated++;

      await sleep(200);
    } catch (e) {
      failed++;
      console.error('Failed enriching media', m.id, m.tmdbId, (e as any)?.message || e);
      await sleep(300);
    }
  }

  console.info('Backfill complete:', { total: medias.length, updated, skipped, failed });
  return { total: medias.length, updated, skipped, failed };
}
