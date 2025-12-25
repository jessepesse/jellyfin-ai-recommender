/**
 * Advocate Service
 * AI-powered system that analyzes blocked content and suggests items
 * the user might now enjoy based on taste profile changes.
 * 
 * "The Advocate" - A defense attorney for blocked movies/shows
 */

import { prisma } from '../db';
import type { Media, UserMedia } from '@prisma/client';

interface RedemptionCandidate {
    media: Media;
    blockedAt: Date;
    appealText: string;
    confidence: number; // 0-100
    reasons: string[];
}

interface RedemptionAnalysis {
    shouldRecommend: boolean;
    confidence: number;
    appealText: string;
    reasoning: string;
}

export class AdvocateService {
    /**
     * Find redemption candidates for a user
     * Analyzes blocked content and returns items worth reconsidering
     */
    static async findRedemptionCandidates(userId: number): Promise<RedemptionCandidate[]> {
        console.log(`[Advocate] Finding redemption candidates for user ${userId}`);

        // Get all blocked media (not permanently blocked, not soft-blocked)
        const now = new Date();
        const blockedMedia = await prisma.userMedia.findMany({
            where: {
                userId,
                status: 'BLOCKED',
                permanentBlock: false,
                OR: [
                    { softBlockUntil: null },
                    { softBlockUntil: { lt: now } }
                ]
            },
            include: {
                media: true
            }
        });

        if (blockedMedia.length === 0) {
            console.log(`[Advocate] No blocked media found for user ${userId}`);
            return [];
        }

        console.log(`[Advocate] Found ${blockedMedia.length} blocked items to analyze`);

        // Get user's current taste profile
        const currentTaste = await this.getUserTasteProfile(userId);

        // Analyze each blocked item
        const analyses = await Promise.all(
            blockedMedia.map(async (userMedia) => {
                try {
                    const analysis = await this.analyzeRedemptionPotential(
                        userMedia.media,
                        currentTaste
                    );

                    if (analysis.shouldRecommend) {
                        return {
                            media: userMedia.media,
                            blockedAt: userMedia.blockedAt!,
                            appealText: analysis.appealText,
                            confidence: analysis.confidence,
                            reasons: this.extractReasons(analysis.reasoning)
                        };
                    }
                    return null;
                } catch (error: any) {
                    console.error(`[Advocate] Error analyzing ${userMedia.media.title}:`, error?.message);
                    return null;
                }
            })
        );

        // Filter out nulls and sort by confidence
        const candidates = analyses
            .filter((c): c is RedemptionCandidate => c !== null)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5); // Top 5

        console.log(`[Advocate] Found ${candidates.length} redemption candidates`);

        // Update redemption attempts
        for (const candidate of candidates) {
            await prisma.userMedia.updateMany({
                where: {
                    userId,
                    mediaId: candidate.media.id
                },
                data: {
                    redemptionAttempts: {
                        increment: 1
                    }
                }
            });
        }

        return candidates;
    }

    /**
     * Analyze if a blocked item should be recommended again
     */
    private static async analyzeRedemptionPotential(
        media: Media,
        tasteProfile: TasteProfile
    ): Promise<RedemptionAnalysis> {
        const genres = media.genres ? JSON.parse(media.genres) : [];
        const keywords = media.keywords ? JSON.parse(media.keywords) : [];

        const prompt = `
You are "The Advocate" - a defense attorney for blocked movies/shows.

BLOCKED ITEM:
- Title: "${media.title}"
- Year: ${media.releaseYear || 'Unknown'}
- Type: ${media.mediaType}
- Genres: ${genres.join(', ')}
- Keywords: ${keywords.join(', ')}
- Rating: ${media.voteAverage || 'N/A'}/10
- Overview: ${media.overview || 'No overview available'}

USER'S CURRENT TASTE PROFILE:
Recently watched and loved:
${tasteProfile.recentlyLoved.map(m => `- ${m.title} (${m.genres.join(', ')})`).join('\n')}

Current favorite genres: ${tasteProfile.favoriteGenres.join(', ')}
Current favorite keywords: ${tasteProfile.favoriteKeywords.join(', ')}

YOUR TASK:
Analyze if this blocked item should be recommended again based on the user's CURRENT taste.

Consider:
1. Does it match their current favorite genres/keywords?
2. Is it similar to what they recently loved?
3. Has their taste evolved to appreciate this type of content?
4. Is it highly rated (>8.0) suggesting they might have misjudged it?

Return ONLY valid JSON (no markdown, no code blocks):
{
  "shouldRecommend": boolean,
  "confidence": number (0-100),
  "appealText": "2-3 sentence appeal explaining why they should reconsider",
  "reasoning": "brief explanation of your decision"
}
`;

        // Use Gemini API directly for text generation
        try {
            const { GoogleGenerativeAI } = await import('@google/generative-ai');
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                throw new Error('GEMINI_API_KEY not configured');
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
            const model = genAI.getGenerativeModel({ model: modelName });

            const result = await model.generateContent(prompt);
            const response = result.response.text();

            // Clean response - remove markdown code blocks if present
            let cleanedResponse = response.trim();
            if (cleanedResponse.startsWith('```json')) {
                cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            } else if (cleanedResponse.startsWith('```')) {
                cleanedResponse = cleanedResponse.replace(/```\n?/g, '');
            }

            const analysis = JSON.parse(cleanedResponse);
            return analysis;
        } catch (error: any) {
            console.error('[Advocate] Gemini API error:', error?.message);
            // Return a default "don't recommend" response on error
            return {
                shouldRecommend: false,
                confidence: 0,
                appealText: 'Unable to analyze at this time.',
                reasoning: `Error: ${error?.message || 'Unknown error'}`
            };
        }
    }

    /**
     * Get user's current taste profile
     */
    private static async getUserTasteProfile(userId: number): Promise<TasteProfile> {
        // Get recently watched/loved items (last 20)
        const recentlyWatched = await prisma.userMedia.findMany({
            where: {
                userId,
                status: 'WATCHED'
            },
            include: {
                media: true
            },
            orderBy: {
                updatedAt: 'desc'
            },
            take: 20
        });

        const recentlyLoved = recentlyWatched.map(um => ({
            title: um.media.title,
            genres: um.media.genres ? JSON.parse(um.media.genres) : [],
            keywords: um.media.keywords ? JSON.parse(um.media.keywords) : []
        }));

        // Extract favorite genres and keywords
        const genreCounts = new Map<string, number>();
        const keywordCounts = new Map<string, number>();

        for (const item of recentlyLoved) {
            for (const genre of item.genres) {
                genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
            }
            for (const keyword of item.keywords) {
                keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
            }
        }

        const favoriteGenres = Array.from(genreCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([genre]) => genre);

        const favoriteKeywords = Array.from(keywordCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([keyword]) => keyword);

        return {
            recentlyLoved,
            favoriteGenres,
            favoriteKeywords
        };
    }

    /**
     * Extract reasons from AI reasoning text
     */
    private static extractReasons(reasoning: string): string[] {
        const reasons: string[] = [];

        if (reasoning.toLowerCase().includes('taste') || reasoning.toLowerCase().includes('evolved')) {
            reasons.push('taste_changed');
        }
        if (reasoning.toLowerCase().includes('rating') || reasoning.toLowerCase().includes('highly rated')) {
            reasons.push('high_rating');
        }
        if (reasoning.toLowerCase().includes('similar') || reasoning.toLowerCase().includes('match')) {
            reasons.push('genre_match');
        }

        return reasons.length > 0 ? reasons : ['general'];
    }
}

interface TasteProfile {
    recentlyLoved: Array<{
        title: string;
        genres: string[];
        keywords: string[];
    }>;
    favoriteGenres: string[];
    favoriteKeywords: string[];
}
