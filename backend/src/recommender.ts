import { JellyfinItem } from './types';

export class Recommender {
    private items: JellyfinItem[];

    constructor(items: JellyfinItem[]) {
        this.items = items.filter(item => item.Genres && item.CommunityRating !== undefined);
    }

    private calculateSimilarity(item1: JellyfinItem, item2: JellyfinItem): number {
        const genres1 = new Set(item1.Genres || []);
        const genres2 = new Set(item2.Genres || []);
        const commonGenres = new Set([...genres1].filter(genre => genres2.has(genre)));
        
        const genreSimilarity = commonGenres.size;
        
        const rating1 = item1.CommunityRating ?? 5;
        const rating2 = item2.CommunityRating ?? 5;
        const ratingSimilarity = 1 - (Math.abs(rating1 - rating2) / 10);

        // Weights (adjust as needed)
        return 0.7 * genreSimilarity + 0.3 * ratingSimilarity;
    }

    public recommend(targetItemId: string, numRecommendations: number = 5): JellyfinItem[] {
        const targetItem = this.items.find(item => item.Id === targetItemId);
        if (!targetItem) {
            return [];
        }

        const scores: { score: number, item: JellyfinItem }[] = [];
        for (const item of this.items) {
            if (item.Id !== targetItem.Id) {
                const score = this.calculateSimilarity(targetItem, item);
                scores.push({ score, item });
            }
        }

        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, numRecommendations).map(score => score.item);
    }
}
