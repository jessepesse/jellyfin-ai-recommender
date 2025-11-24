import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Wipe DB script starting — this will DELETE media, userMedia, and users.');

    // Report current counts
    const beforeMedia = await prisma.media.count();
    const beforeUserMedia = await prisma.userMedia.count();
    const beforeUsers = await prisma.user.count();
    console.log(`Before: media=${beforeMedia}, userMedia=${beforeUserMedia}, users=${beforeUsers}`);

    // Delete userMedia first (FK to media)
    const deletedUserMedia = await prisma.userMedia.deleteMany({});
    console.log(`Deleted userMedia: ${deletedUserMedia.count}`);

    // Delete media rows
    const deletedMedia = await prisma.media.deleteMany({});
    console.log(`Deleted media: ${deletedMedia.count}`);

    // Optionally delete users (keeps user accounts reset)
    const deletedUsers = await prisma.user.deleteMany({});
    console.log(`Deleted users: ${deletedUsers.count}`);

    // Report after counts
    const afterMedia = await prisma.media.count();
    const afterUserMedia = await prisma.userMedia.count();
    const afterUsers = await prisma.user.count();
    console.log(`After: media=${afterMedia}, userMedia=${afterUserMedia}, users=${afterUsers}`);

    console.log('Wipe DB script finished successfully.');
  } catch (e) {
    console.error('Wipe DB script failed:', e);
    process.exitCode = 1;
  } finally {
    try { await prisma.$disconnect(); } catch {}
  }
}

main();
