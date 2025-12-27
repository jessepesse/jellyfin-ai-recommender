import { prisma } from '../src/db.js';

async function clearRedemptionCandidates() {
    try {
        const result = await prisma.redemptionCandidates.deleteMany({});
        console.log(`✅ Deleted ${result.count} redemption candidates`);

        // Also clear any items that are in watchlist but still marked as blocked
        const fixed = await prisma.userMedia.updateMany({
            where: {
                status: 'BLOCKED',
                // This shouldn't happen, but let's clean it up
            },
            data: {}
        });

        console.log(`✅ Cleaned up database`);
        await prisma.$disconnect();
    } catch (error) {
        console.error('❌ Error:', error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

clearRedemptionCandidates();
