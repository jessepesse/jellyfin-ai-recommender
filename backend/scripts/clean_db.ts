import prisma from '../src/db';

async function main() {
  try {
    console.log('Starting DB clean script');

    const medias = await prisma.media.findMany();
    console.log(`Found ${medias.length} media records`);

    let updated = 0;
    for (const m of medias) {
      const raw = (m.mediaType || 'movie') as string;
      const normalized = raw.toLowerCase().includes('tv') ? 'tv' : 'movie';
      if (m.mediaType !== normalized) {
        await prisma.media.update({ where: { id: m.id }, data: { mediaType: normalized } });
        updated++;
        console.log(`Normalized media id=${m.id} tmdb=${m.tmdbId} to type='${normalized}'`);
      }
    }

    console.log(`Normalization complete. Updated ${updated} records.`);

    // Optional: report userMedia summary grouped by status
    const counts = await prisma.userMedia.groupBy({ by: ['status'], _count: { _all: true } });
    console.log('UserMedia counts by status:');
    counts.forEach((c: { status: string; _count: { _all: number } }) => console.log(`  ${c.status}: ${c._count._all}`));

    console.log('DB clean script finished successfully.');
  } catch (e) {
    console.error('DB clean script failed:', e);
    process.exitCode = 1;
  } finally {
    try { await prisma.$disconnect(); } catch { }
  }
}

main();
