import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import OpenAI from 'openai';
import { z } from 'zod';
import ConfigService from './config';
import { MediaItemInput, UserData, RecommendationCandidate, RecommendationFilters } from '../types';

// Gemini 2.5+ and 3.0+ models automatically use internal thinking for improved reasoning
// Thinking dynamically adjusts based on prompt complexity
const DEFAULT_MODEL = 'gemini-3-flash-preview';

// Unified AI Client Bundle that works with both Google AI and OpenRouter
export interface AIClientBundle {
  provider: 'google' | 'openrouter';
  modelName: string;
  // Google AI SDK
  googleClient?: GoogleGenerativeAI;
  googleModel?: GenerativeModel;
  // OpenRouter via OpenAI SDK
  openrouterClient?: OpenAI;
}

// Build AI client based on configured provider
export async function buildClientAndModel(): Promise<AIClientBundle> {
  const cfg = await ConfigService.getConfig();
  const provider = cfg.aiProvider || 'google';
  const modelNameFromCfg = cfg.aiModel ? String(cfg.aiModel).trim() : DEFAULT_MODEL;

  console.log(`[AI] Provider: ${provider}, Model: ${modelNameFromCfg}`);

  if (provider === 'openrouter') {
    // OpenRouter setup
    const rawKey = cfg.openrouterApiKey ? String(cfg.openrouterApiKey) : (process.env.OPENROUTER_API_KEY || '');
    const apiKey = rawKey.trim();

    if (!apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const openrouterClient = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/jellyfin-ai-recommender',
        'X-Title': 'Jellyfin AI Recommender'
      }
    });

    // OpenRouter requires google/ prefix for Gemini models if not already present
    // But commonly used models on OpenRouter might be 'google/gemini-2.0-flash-exp:free' etc.
    // If the user selects a model from dropdown that is google specific (e.g. 'gemini-1.5-pro'), prepending google/ is safer.
    // Ideally the dropdown values should already be correct for OpenRouter or mapped.
    // For now we assume the model name might need 'google/' prefix if using mapped external names.
    const openrouterModelName = (modelNameFromCfg.indexOf('/') === -1 && modelNameFromCfg.startsWith('gemini'))
      ? `google/${modelNameFromCfg}`
      : modelNameFromCfg;

    return {
      provider: 'openrouter',
      modelName: openrouterModelName,
      openrouterClient
    };
  } else {
    // Google AI Direct setup
    const rawKey = cfg.geminiApiKey ? String(cfg.geminiApiKey) : (process.env.GEMINI_API_KEY || '');
    const apiKey = rawKey.trim();

    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const googleClient = new GoogleGenerativeAI(apiKey);

    // Configure thinking level for Gemini 3 Flash/Pro models
    const isGemini3Model = modelNameFromCfg.includes('gemini-3');
    const isProModel = modelNameFromCfg.includes('-pro');
    const thinkingLevel = isProModel ? 'high' : 'medium';

    const thinkingConfig = isGemini3Model ? {
      thinkingConfig: {
        thinkingBudget: thinkingLevel as 'low' | 'medium' | 'high'
      }
    } : {};

    const googleModel = googleClient.getGenerativeModel({
      model: modelNameFromCfg,
      ...thinkingConfig
    });

    return {
      provider: 'google',
      modelName: modelNameFromCfg,
      googleClient,
      googleModel
    };
  }
}

// Unified content generation function that works with both providers
export async function generateAIContent(
  client: AIClientBundle,
  prompt: string,
  options?: { json?: boolean; jsonSchema?: object }
): Promise<string> {
  if (client.provider === 'openrouter' && client.openrouterClient) {
    const response = await client.openrouterClient.chat.completions.create({
      model: client.modelName,
      messages: [{ role: 'user', content: prompt }],
      response_format: options?.json ? { type: 'json_object' } : undefined,
      max_tokens: 8000,
    });
    return response.choices[0]?.message?.content || '';
  } else if (client.provider === 'google' && client.googleModel) {
    const response = await client.googleModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: options?.json ? {
        responseMimeType: 'application/json',
        responseSchema: options.jsonSchema as any
      } : undefined
    });

    const body = response?.response;
    if (body && typeof body.text === 'function') {
      const result = body.text();
      return typeof result === 'string' ? result : await result;
    }
    return '';
  }

  throw new Error('No AI client configured');
}

// Zod schema for validated AI output
// NOTE: Gemini must NOT return any IDs. We only accept title, media_type, release_year and reason.
const RecommendationSchema = z.array(z.object({
  title: z.string(),
  media_type: z.union([z.literal('movie'), z.literal('tv'), z.string()]).optional(),
  // release_year may be number or string (some models produce strings)
  release_year: z.union([z.string(), z.number()]),
  reason: z.string().optional(),
}));

export class GeminiService {
  // Build prompt similar to legacy implementation
  /**
   * Formats a list of items into a compact table:
   * | Title | Year |
   */
  private static formatTable(list: (MediaItemInput | string)[]): string {
    if (!list || list.length === 0) return '(none)';

    const uniqueEntries = new Set<string>();
    const rows: string[] = [];

    list.forEach(item => {
      let title = '';
      let year = '';

      if (typeof item === 'string') {
        title = item;
      } else {
        title = item.title || item.name || item.originalTitle || item.Title || '';
        const rawYear = item.release_year || item.releaseYear || item.releaseDate || item.release_date || item.year || '';
        year = typeof rawYear !== 'string' ? String(rawYear || '') : rawYear;
      }

      title = String(title).replace(/\|/g, '').trim();
      year = (year || '').toString().substring(0, 4);

      if (title) {
        const entryKey = `${title.toLowerCase()}:${year}`;
        if (!uniqueEntries.has(entryKey)) {
          uniqueEntries.add(entryKey);
          rows.push(`| ${title} | ${year} |`);
        }
      }
    });

    return rows.join('\n');
  }

  private static buildPrompt(username: string, userData: UserData, likedItems: MediaItemInput[], dislikedItems: MediaItemInput[], filters?: RecommendationFilters): string {
    // Backwards-compatible buildPrompt that can accept a precomputed tasteProfile and an exclusionTable
    return (username && userData) ? this.buildPromptWithProfile(username, userData, likedItems, dislikedItems, filters) : '';
  }

  // New prompt builder that prefers a provided taste profile and an explicit exclusion table
  private static buildPromptWithProfile(
    username: string,
    userData: UserData,
    likedItems: MediaItemInput[],
    dislikedItems: MediaItemInput[],
    filters?: RecommendationFilters,
    tasteProfile?: string,
    exclusionTable?: string
  ): string {
    const mediaType = filters?.type ? String(filters.type).toUpperCase() : 'MOVIE OR TV SERIES';
    const genreNote = filters?.genre ? `Focus strictly on the genre: "${filters.genre}".` : 'Recommend diverse genres that match the user\'s taste.';

    let moodNote = '';
    if (filters?.mood) {
      const moodMap: Record<string, string> = {
        'chill': 'Chill / Comfort / Brain Off. Recommend familiar, safe, comforting, or lighthearted content that is easy to watch.',
        'mind-bending': 'Mind Bending / Intellectual. Recommend complex, thought-provoking, philosophical, or mystery-heavy content that requires active attention.',
        'dark': 'Dark & Gritty. Recommend serious, realistic, intense, or visually dark content. Avoid light comedies.',
        'adrenaline': 'Adrenaline / Action. Recommend high-octane, fast-paced, edge-of-seat thrillers or action movies.',
        'feel-good': 'Feel Good. Recommend uplifting, happy, optimistic content that leaves the viewer in a good mood.',
        'tearjerker': 'Tearjerker / Emotional. Recommend highly emotional dramas or romances that might make the viewer cry.',
        'visual': 'Visually Stunning / Epic. Recommend movies/series known for their cinematography, scale, and visual beauty.'
      };
      const key = filters.mood.toLowerCase();
      const desc = moodMap[key] || filters.mood;
      moodNote = `\n- MOOD: ${desc}`;
    }

    // Filter context by media type to send ONLY relevant history
    // This improves recommendation relevance and saves tokens
    let contextLiked = likedItems;
    let contextDisliked = dislikedItems;

    if (filters?.type) {
      const targetType = filters.type.toLowerCase();

      // Filter liked items to match requested type
      contextLiked = likedItems.filter(item => {
        const itemType = (item.mediaType || item.media_type || item.type || '').toLowerCase();
        return itemType === targetType;
      });

      // Filter disliked items to match requested type
      contextDisliked = dislikedItems.filter(item => {
        const itemType = (item.mediaType || item.media_type || item.type || '').toLowerCase();
        return itemType === targetType;
      });
    }

    const hasProfile = !!tasteProfile && String(tasteProfile).trim().length > 10;
    const fallbackProfile = `No explicit taste profile is available for this user.\nFor the purposes of recommendation, assume a broadly-curated, mainstream taste that prefers well-rated, accessible titles across popular genres (drama, action, comedy, thriller, family).\nProvide diverse suggestions (mix of recent and classic titles) that would suit a general audience.\nEven if user history is empty, you MUST provide recommendations immediately. Do not ask clarifying questions.`;
    const profileSection = hasProfile ? tasteProfile as string : `${fallbackProfile}\n\nSeed Titles:\n${this.formatTable(Array.isArray(contextLiked) ? contextLiked.slice(0, 100) : [])}`;

    // Send FULL exclusion table - Gemini 2.5+ has 1M+ token context, so we can send everything
    // This is the user's complete watch history, watchlist, and blocked items
    const exclusionSection = exclusionTable && exclusionTable.length > 0
      ? exclusionTable
      : this.formatTable(Array.isArray(contextDisliked) ? contextDisliked : []);

    // Count exclusion items for transparency
    const exclusionCount = exclusionSection.split('\n').filter(line => line.startsWith('|')).length;

    return `
### ROLE
Act as a senior film critic and expert database curator (TMDb specialist).
Your goal is to recommend **exactly 40** distinct items that perfectly match the user's taste profile but are NOT in their current library.

### CONTEXT & TASTE PROFILE
- **Media Type:** ${mediaType}
- **Vibe/Genre:** ${genreNote}${moodNote}

${hasProfile ? `**Taste Analysis:**\n${profileSection}` : profileSection}

---

### �️ EXCLUSION DATA (POISON LIST) - ${exclusionCount} items
The user has ALREADY watched/collected the following items.
**CRITICAL RULE:** Do NOT recommend anything from this list. Treat these titles as "poison".
If you are about to suggest a sequel/prequel to a movie in this list, SKIP IT unless it is significantly better rated.

| Title | Year |
|-------|------|
${exclusionSection}

---

### 💎 SELECTION RULES
1. **Discovery First:** Focus on hidden gems, highly-rated non-mainstream hits, or classics the user might have missed.
2. **No Franchise Stacking:** Do NOT recommend more than 1 item from the same franchise (e.g., if you suggest "Alien", do not suggest "Aliens").
3. **Accuracy:** Use the EXACT theatrical release year from TMDb. If unsure, skip the item.
4. **Variety:** Mix genres slightly. If the user likes Sci-Fi, include some Sci-Fi Horror or Sci-Fi Thriller, not just Space Operas.
5. **No Poison:** NEVER suggest anything from the POISON LIST above. Double-check every recommendation.

---

### 📝 OUTPUT FORMAT
Return **ONLY** a raw JSON array (no markdown, no backticks).
Each object must strictly follow this schema:
[
  {
    "title": "Exact TMDb Title",
    "media_type": "${mediaType === 'MOVIE OR TV SERIES' ? 'movie' : mediaType.toLowerCase()}",
    "release_year": "YYYY",
    "reason": "A short, punchy sentence why this fits the vibe."
  }
]
`;
  }

  // Summarize a user's taste profile using Gemini (compact text)
  // Summarize a user's taste profile using AI (compact text)
  // Works with both Google AI and OpenRouter
  public static async summarizeProfile(username: string, seedItems: MediaItemInput[], type: 'movie' | 'tv'): Promise<string> {
    try {
      const client = await buildClientAndModel();
      const titles = (seedItems || []).slice(0, 80).map((s: MediaItemInput) => s.title || s.name || s.Title || '').filter(Boolean).slice(0, 80);
      const prompt = `
Analyze the user's ${type} taste based on these titles:
${titles.join('\n')}

Task:
Generate 3 short, insightful but casual bullet points describing their specific taste (themes, moods, genres).

Constraints:
- Do NOT use markdown formatting (no **bold**, no *italics*).
- Do NOT use headers.
- Return ONLY the bullet points as plain text.
- Keep each point under 20 words if possible.
`;

      const text = await generateAIContent(client, prompt);
      return (text || '').trim().substring(0, 2000);
    } catch (e) {
      console.warn('summarizeProfile failed', e);
      return '';
    }
  }

  public static async getRecommendations(
    username: string,
    userData: UserData,
    likedItems: MediaItemInput[],
    dislikedItems: MediaItemInput[],
    filters?: RecommendationFilters,
    tasteProfile?: string,
    exclusionTable?: string
  ): Promise<RecommendationCandidate[]> {
    const prompt = this.buildPromptWithProfile(username, userData, likedItems, dislikedItems, filters, tasteProfile, exclusionTable);

    try {
      const client = await buildClientAndModel();
      console.debug(`[AI] Attempting to call ${client.provider} with model: ${client.modelName}`);

      // Ensure prompt is a string
      const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

      // Get JSON schema for structured output if available
      let schema: object | undefined;
      try {
        const { zodToJsonSchema } = await import('zod-to-json-schema');
        // Cast to any to avoid TypeScript incompatibilities between zod versions/types.
        schema = (zodToJsonSchema as any)(RecommendationSchema as any);
      } catch (e) {
        // zod-to-json-schema not available, proceed without schema
      }

      // Use unified content generation
      const text = await generateAIContent(client, promptText, { json: true, jsonSchema: schema });
      console.debug(`[AI] Response text received: ${text?.substring(0, 100)}... (Total: ${text?.length} chars)`);

      if (!text) {
        console.warn('AI returned no text; using heuristic fallback');
        throw new Error('Empty AI response');
      }

      // Extract JSON array from text. Only attempt JSON.parse when a JSON array is found.
      const first = text.indexOf('[');
      const last = text.lastIndexOf(']');
      if (first === -1 || last === -1 || last <= first) {
        console.warn('No JSON array found in AI output; skipping parse. Raw output:', text.substring(0, 200));
      } else {
        const jsonText = text.substring(first, last + 1);
        try {
          const parsed = JSON.parse(jsonText);
          const validated = RecommendationSchema.safeParse(parsed);
          if (validated.success) {
            // Return parsed items but importantly DO NOT include any TMDB id from AI.
            // We include release_year and reason so downstream enrichment can use year matching.
            return validated.data.map((p): RecommendationCandidate => ({
              title: p.title,
              media_type: p.media_type || 'movie',
              release_year: p.release_year,
              reason: p.reason,
            }));
          } else {
            console.warn('AI output failed Zod validation:', validated.error);
          }
        } catch (e) {
          console.error('Failed to parse AI JSON output:', e);
        }
      }
    } catch (e: any) {
      try { console.error('AI SDK Error:', JSON.stringify(e, Object.getOwnPropertyNames(e), 2)); } catch { console.error('AI SDK Error (string):', String(e)); }
      console.warn('AI SDK failed; using heuristic fallback');
    }

    // Fallback heuristic
    console.log('[AI] Triggering heuristic fallback due to AI failure or empty result.');
    try {
      if (!likedItems || likedItems.length === 0) {
        console.warn('[AI] No liked items to use for fallback!');
        return [];
      }

      const scored = (likedItems || []).slice().sort((a: MediaItemInput, b: MediaItemInput) => {
        const ratingA = a.voteAverage ?? a.vote_average ?? a.rating ?? 0;
        const ratingB = b.voteAverage ?? b.vote_average ?? b.rating ?? 0;
        return Number(ratingB) - Number(ratingA);
      });
      console.log(`[AI] Fallback found ${scored.length} items to use as base.`);
      return scored.slice(0, 10).map((s: MediaItemInput): RecommendationCandidate => ({
        title: s.name || s.title || s.Title || 'Unknown',
        media_type: s.mediaType || s.media_type || s.type || 'movie',
        release_year: s.releaseYear || s.release_year || s.year || '',
      }));
    } catch (e) {
      console.error('Fallback recommender error:', e);
    }

    return [];
  }

  /**
   * Rank and filter anchor-based candidates using Gemini
   * Takes pre-fetched TMDB candidates and asks Gemini to evaluate quality and relevance
   * 
   * @param candidates - Array of candidate objects with title, genres, overview
   * @param userContext - User's taste profile and preferences
   * @param filters - Genre, mood, type filters
   * @param limit - Max results to return (default 10)
   * @returns Ranked array of candidate titles with reasons
   */
  static async rankCandidates(
    candidates: Array<{
      tmdbId: number;
      title: string;
      genres: string[];
      overview?: string;
      voteAverage?: number;
    }>,
    userContext: {
      tasteProfile?: string;
      recentFavorites?: string[];
      requestedGenre?: string;
      requestedMood?: string;
    },
    limit: number = 10
  ): Promise<Array<{ tmdbId: number; title: string; reason: string }>> {
    if (candidates.length === 0) return [];

    try {
      const client = await buildClientAndModel();
      console.debug(`[AI Ranking] Using provider: ${client.provider}, model: ${client.modelName} for ${candidates.length} candidates`);

      // Format candidates for prompt
      const candidateList = candidates.slice(0, 30).map((c, i) =>
        `${i + 1}. [ID:${c.tmdbId}] "${c.title}" [${c.genres.join(', ')}] - Rating: ${c.voteAverage?.toFixed(1) || 'N/A'}\n   ${(c.overview || 'No description').substring(0, 100)}...`
      ).join('\n');

      // Build context
      const tasteContext = userContext.tasteProfile
        ? `User's taste profile: ${userContext.tasteProfile}`
        : '';
      const favoritesContext = userContext.recentFavorites?.length
        ? `Recent favorites: ${userContext.recentFavorites.slice(0, 5).join(', ')}`
        : '';
      const genreContext = userContext.requestedGenre
        ? `Requested genre: ${userContext.requestedGenre}`
        : '';

      // Provide detailed mood descriptions for AI
      const moodDescriptions: Record<string, string> = {
        'mind-bending': 'MIND-BENDING: Complex plots, twist endings, psychological themes, surreal, nonlinear timelines, makes you think',
        'dark': 'DARK & GRITTY: Noir, dystopian, crime, violence, morally ambiguous, intense, serious themes',
        'adrenaline': 'ADRENALINE: Action-packed, thrilling, car chases, explosions, heists, high stakes, intense',
        'chill': 'CHILL & COMFORT: Relaxing, heartwarming, slice of life, feel-good, cozy, low-stakes, peaceful',
        'feel-good': 'FEEL-GOOD: Uplifting, happy endings, comedy, romance, family-friendly, optimistic, warm',
        'tearjerker': 'TEARJERKER: Emotional, tragic, loss, grief, moving, will make you cry, bittersweet',
        'visual': 'VISUAL/EPIC: Stunning visuals, epic scope, fantasy worlds, sci-fi, cinematographic masterpiece',
      };
      const moodContext = userContext.requestedMood && moodDescriptions[userContext.requestedMood]
        ? `CRITICAL - User wants this mood: ${moodDescriptions[userContext.requestedMood]}. PRIORITIZE titles matching this mood!`
        : '';

      const prompt = `You have a list of real candidates here. Select ${limit} that will **blow this user's mind**.

${tasteContext}
${favoritesContext}
${genreContext}
${moodContext}

CANDIDATES:
${candidateList}

Return JSON array of ${limit} best picks: [{"tmdbId": 123, "title": "Name"}, ...]

ONLY JSON. NO TEXT.`;

      // Debug: log prompt size and first candidate
      console.debug(`[AI Ranking] Prompt length: ${prompt.length} chars, first candidate: ${candidates[0]?.title}`);

      const responseText = await generateAIContent(client, prompt, { json: true });
      console.debug(`[AI Ranking] Raw response length: ${responseText.length} chars`);

      // Try parsing directly first
      let parsed: any[] = [];
      try {
        parsed = JSON.parse(responseText);
        console.debug(`[AI Ranking] Direct parse succeeded with ${parsed.length} items`);
      } catch (directParseError) {
        console.debug(`[AI Ranking] Direct parse failed: ${(directParseError as Error).message}`);
        // If direct parse fails, try regex extraction
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          console.warn('[AI Ranking] No valid JSON in response, first 300 chars:', JSON.stringify(responseText.substring(0, 300)));
          // Fallback: return top candidates by rating
          return candidates
            .sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0))
            .slice(0, limit)
            .map(c => ({ tmdbId: c.tmdbId, title: c.title, reason: 'Top rated' }));
        }
        parsed = JSON.parse(jsonMatch[0]);
      }

      console.debug(`[AI Ranking] Selected ${parsed.length} items from ${candidates.length} candidates`);

      return parsed.slice(0, limit);
    } catch (e: any) {
      console.error('[AI Ranking] Error:', e?.message || e);
      // Fallback: return top candidates by rating
      return candidates
        .sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0))
        .slice(0, limit)
        .map(c => ({ tmdbId: c.tmdbId, title: c.title, reason: 'Fallback recommendation' }));
    }
  }

  /**
   * Analyze user's watch history and extract taste preferences for TMDB Discover
   * Returns semantic data (genre names, keywords) NOT TMDB IDs
   * 
   * @param watchHistory - User's watched items with basic metadata
   * @param mediaType - 'movie' or 'tv'
   * @returns Structured taste analysis for building TMDB Discover queries
   */
  static async analyzeUserTaste(
    watchHistory: Array<{
      title: string;
      genres: string[];
      year?: number;
      rating?: number;
    }>,
    mediaType: 'movie' | 'tv'
  ): Promise<{
    tasteProfile: string;
    genres: string[];
    keywords: string[];
    yearRange: [number, number] | null;
    minRating: number;
  }> {
    if (watchHistory.length === 0) {
      return {
        tasteProfile: 'Not enough watch history to analyze preferences.',
        genres: ['Drama', 'Comedy'],
        keywords: [],
        yearRange: null,
        minRating: 6.5,
      };
    }

    try {
      const client = await buildClientAndModel();

      // Format watch history for prompt
      const historyList = watchHistory.slice(0, 50).map(item =>
        `- "${item.title}" (${item.year || 'N/A'}) [${item.genres.join(', ')}] ${item.rating ? `★${item.rating.toFixed(1)}` : ''}`
      ).join('\n');

      const prompt = `Analyze this user's ${mediaType === 'movie' ? 'movie' : 'TV show'} watch history and identify their preferences.

WATCH HISTORY:
${historyList}

Based on this history, provide a JSON analysis with:
1. tasteProfile: One engaging sentence describing their taste (e.g., "You love dark psychological thrillers with complex characters")
2. genres: Array of 2-4 genre names they prefer (use standard genre names like: Action, Comedy, Drama, Thriller, Horror, Romance, Sci-Fi, Fantasy, Documentary, Crime, Mystery, Animation)
3. keywords: Array of EXACTLY 6 thematic keywords for TMDB search. Use SIMPLE words that TMDB recognizes:
   - GOOD: "heist", "dystopia", "noir", "revenge", "conspiracy", "time travel", "serial killer", "robot"
   - BAD: "prestige drama", "found family", "character study" (too complex, won't match)
4. yearRange: [startYear, endYear] if they have a specific era preference, or null if no preference
5. minRating: Recommended minimum rating threshold (6.0-8.0)

Return ONLY valid JSON:
{
  "tasteProfile": "...",
  "genres": ["Drama", "Thriller"],
  "keywords": ["heist", "noir", "conspiracy", "revenge", "thriller", "crime"],
  "yearRange": null,
  "minRating": 7.0
}`;

      console.debug(`[AI Taste] Analyzing ${watchHistory.length} ${mediaType} items`);

      const responseText = await generateAIContent(client, prompt, { json: true });
      console.debug(`[AI Taste] Response length: ${responseText.length} chars`);

      // Try to parse JSON - handle markdown code blocks
      let parsed: any;
      let cleanedText = responseText.trim();

      // Remove markdown code blocks if present
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      try {
        parsed = JSON.parse(cleanedText);
      } catch {
        // Try to extract JSON object from response
        const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (innerErr) {
            console.debug(`[AI Taste] JSON extraction failed, raw response: ${cleanedText.substring(0, 200)}`);
            throw new Error('No valid JSON in response');
          }
        } else {
          console.debug(`[AI Taste] No JSON found, raw response: ${cleanedText.substring(0, 200)}`);
          throw new Error('No valid JSON in response');
        }
      }

      console.debug(`[AI Taste] Analysis complete: ${parsed.genres?.length || 0} genres, ${parsed.keywords?.length || 0} keywords`);

      return {
        tasteProfile: parsed.tasteProfile || 'Personalized picks curated just for you! 🎬',
        genres: Array.isArray(parsed.genres) ? parsed.genres.slice(0, 4) : ['Drama'],
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 6) : [],
        yearRange: Array.isArray(parsed.yearRange) && parsed.yearRange.length === 2 ? parsed.yearRange : null,
        minRating: typeof parsed.minRating === 'number' ? Math.max(5, Math.min(9, parsed.minRating)) : 6.5,
      };
    } catch (e: any) {
      console.error('[AI Taste] Analysis failed:', e?.message || e);
      // Fallback: extract most common genres from history
      const genreCounts: Record<string, number> = {};
      watchHistory.forEach(item => {
        item.genres.forEach(g => {
          genreCounts[g] = (genreCounts[g] || 0) + 1;
        });
      });
      const topGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([genre]) => genre);

      return {
        tasteProfile: `We've handpicked these based on your love for ${topGenres.slice(0, 2).join(' & ') || 'great content'}! 🍿`,
        genres: topGenres.length > 0 ? topGenres : ['Drama', 'Comedy'],
        keywords: [],
        yearRange: null,
        minRating: 6.5,
      };
    }
  }

  // ==========================================
  // DUAL-AI SYSTEM FOR WEEKLY PICKS
  // ==========================================

  /**
   * CURATOR AGENT: Discovery specialist that finds hidden gems
   * Selects candidates from TMDB pool and provides 1-sentence justification for each
   * 
   * @param candidates - TMDB candidates with metadata
   * @param userTaste - User's taste profile from analyzeUserTaste()
   * @param limit - Number of candidates to select (default 100)
   * @returns Candidates with justifications
   */
  static async curatorDiscover(
    candidates: Array<{
      tmdbId: number;
      title: string;
      overview?: string;
      genres: string[];
      voteAverage?: number;
    }>,
    userTaste: {
      tasteProfile: string;
      genres: string[];
      keywords: string[];
    },
    limit: number = 100
  ): Promise<Array<{ tmdbId: number; title: string; reason: string }>> {
    if (candidates.length === 0) {
      return [];
    }

    try {
      const client = await buildClientAndModel();
      console.debug(`[Curator] Processing ${candidates.length} candidates for user with taste: ${userTaste.tasteProfile.substring(0, 50)}...`);

      // Format candidates (limit to first 150 to avoid token limits)
      const candidateList = candidates.slice(0, 150).map((c, i) =>
        `${i + 1}. [ID:${c.tmdbId}] "${c.title}" [${c.genres.join(', ')}] ★${c.voteAverage?.toFixed(1) || 'N/A'}\n   ${(c.overview || '').substring(0, 80)}...`
      ).join('\n');

      const prompt = `You are a CURATOR - a film recommendation expert.

USER TASTE PROFILE:
"${userTaste.tasteProfile}"
Preferred genres: ${userTaste.genres.join(', ')}
Thematic interests: ${userTaste.keywords.join(', ')}

CANDIDATE POOL (${candidates.length} titles):
${candidateList}

YOUR TASK:
Select the ${limit} BEST matches for this user. For each, provide a 1-sentence reason why it fits their taste.

Focus on:
- HIGH QUALITY titles with good ratings (★7.0+)
- Excellent matches for their genre preferences
- Mix of acclaimed classics AND newer releases
- Titles they will genuinely enjoy

Return ONLY a valid JSON array (no markdown, no explanation):
[{"tmdbId": 123, "title": "Example", "reason": "Compelling drama matching your taste"}, ...]

IMPORTANT: Output MUST be valid JSON starting with [ and ending with ]`;

      const responseText = await generateAIContent(client, prompt, { json: true });
      console.debug(`[Curator] Response length: ${responseText.length} chars`);

      // Parse JSON
      let parsed: Array<{ tmdbId: number; title: string; reason: string }> = [];
      try {
        parsed = JSON.parse(responseText);
      } catch {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No valid JSON in Curator response');
        }
      }

      console.debug(`[Curator] Selected ${parsed.length} candidates with reasons`);
      return parsed.slice(0, limit);

    } catch (e: any) {
      console.error('[Curator] Error:', e?.message || e);
      // Fallback: return top candidates by rating with generic reason
      return candidates
        .sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0))
        .slice(0, limit)
        .map(c => ({ tmdbId: c.tmdbId, title: c.title, reason: 'Top-rated in your preferred genres' }));
    }
  }

  /**
   * CRITIC AGENT: Quality guardian that ensures only 5/5 content passes
   * Reviews Curator's picks and selects only the absolute best
   * 
   * @param curatorPicks - Candidates selected by Curator with reasons
   * @param blocklist - TMDB IDs the user has blocked
   * @param limit - Final number to select (default 10)
   * @returns Top picks (WOW-factor only)
   */
  static async criticSelect(
    curatorPicks: Array<{ tmdbId: number; title: string; reason: string }>,
    blocklist: number[],
    limit: number = 10
  ): Promise<Array<{ tmdbId: number; title: string }>> {
    if (curatorPicks.length === 0) {
      return [];
    }

    // Pre-filter obvious blocklist matches
    const filtered = curatorPicks.filter(p => !blocklist.includes(p.tmdbId));

    if (filtered.length <= limit) {
      // Not enough candidates, return all
      return filtered.map(p => ({ tmdbId: p.tmdbId, title: p.title }));
    }

    try {
      const client = await buildClientAndModel();
      console.debug(`[Critic] Reviewing ${filtered.length} candidates, blocklist size: ${blocklist.length}`);

      // Format curator picks with their reasons
      const picksList = filtered.map((p, i) =>
        `${i + 1}. [ID:${p.tmdbId}] "${p.title}"\n   Curator's reason: ${p.reason}`
      ).join('\n');

      const prompt = `You are a CRITIC - a quality guardian who ensures great recommendations.

BLOCKLIST IDs (user rejected these, avoid similar content):
${blocklist.slice(0, 50).join(', ') || '(none)'}

CURATOR'S PICKS (with reasons):
${picksList}

YOUR TASK:
From these ${filtered.length} options, select the TOP ${limit} that best match the user's taste.

SELECTION CRITERIA:
- Strong match to user's preferences
- High quality, well-rated content
- NOT similar to blocklist content
- Curator's reason is compelling

Return ONLY a valid JSON array (no markdown, no explanation):
[{"tmdbId": 123, "title": "Example"}, ...]

IMPORTANT: Output MUST be valid JSON starting with [ and ending with ]`;

      const responseText = await generateAIContent(client, prompt, { json: true });
      console.debug(`[Critic] Response length: ${responseText.length} chars`);
      console.debug(`[Critic] Raw response: ${responseText.substring(0, 300)}`);

      // Parse JSON - handle markdown code blocks
      let parsed: Array<{ tmdbId: number; title: string }> = [];
      let cleanedText = responseText.trim();

      // Remove markdown code blocks if present
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      try {
        parsed = JSON.parse(cleanedText);
      } catch {
        const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No valid JSON in Critic response');
        }
      }

      console.debug(`[Critic] Approved ${parsed.length} titles from ${filtered.length} candidates`);
      return parsed.slice(0, limit);

    } catch (e: any) {
      console.error('[Critic] Error:', e?.message || e);
      // Fallback: return first N from filtered list
      return filtered.slice(0, limit).map(p => ({ tmdbId: p.tmdbId, title: p.title }));
    }
  }
}

