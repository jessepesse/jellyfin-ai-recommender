import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { z } from 'zod';
import ConfigService from './config';
import { MediaItemInput, UserData, RecommendationCandidate, RecommendationFilters } from '../types';

// Default model with thinking support enabled
// Gemini 2.5+ and 3.0+ models automatically use internal thinking for improved reasoning
// Thinking dynamically adjusts based on prompt complexity
const modelName = 'gemini-3-flash-preview';
console.debug('Using Gemini model:', modelName);

// Construct SDK client at runtime and return both the raw client, the generative model instance, and the resolved model name
interface GeminiClientBundle {
  client: GoogleGenerativeAI;
  model: GenerativeModel;
  modelName: string;
}

async function buildClientAndModel(): Promise<GeminiClientBundle> {
  const cfg = await ConfigService.getConfig();
  const rawKey = (cfg && cfg.geminiApiKey) ? String(cfg.geminiApiKey) : (process.env.GEMINI_API_KEY || '');
  const apiKey = rawKey ? rawKey.trim() : '';
  const source = (cfg && cfg.geminiApiKey) ? 'DB' : (process.env.GEMINI_API_KEY ? 'ENV' : 'NONE');
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  } else {
    try {
      // Log source only, never log API keys (even masked) to prevent timing attacks
      console.info(`Gemini key source: ${source}`);
    } catch (e) {
      // best-effort logging only
    }
  }

  // Instantiate SDK client (pass API key as string directly)
  const client = new GoogleGenerativeAI(apiKey);

  // Obtain the model object from the client
  const modelNameFromCfg = cfg && cfg.geminiModel ? String(cfg.geminiModel).trim() : modelName;

  // Configure thinking level for Gemini 3 Flash/Pro models
  // Flash supports: minimal, low, medium, high
  // Pro supports: low, high (default)
  // Use 'high' for Pro (maximizes reasoning depth for recommendations)
  // Use 'medium' for Flash (balanced thinking for most tasks)
  const isGemini3Model = modelNameFromCfg.includes('gemini-3');
  const isProModel = modelNameFromCfg.includes('-pro');
  const thinkingLevel = isProModel ? 'high' : 'medium';

  const thinkingConfig = isGemini3Model ? {
    thinkingConfig: {
      thinkingBudget: thinkingLevel as 'low' | 'medium' | 'high'
    }
  } : {};

  const model = client.getGenerativeModel({
    model: modelNameFromCfg,
    ...thinkingConfig
  });

  return { client, model, modelName: modelNameFromCfg };
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
  // Thinking is automatically enabled for 2.5+ and 3.0+ models
  public static async summarizeProfile(username: string, seedItems: MediaItemInput[], type: 'movie' | 'tv'): Promise<string> {
    try {
      const { model } = await buildClientAndModel();
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

      // Use modern API with proper message format
      const resp = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }]
      });
      let text = '';
      try {
        const body = resp?.response;
        if (body && typeof body.text === 'function') {
          const maybe = body.text();
          // Handle both sync and async text() results
          text = (maybe && typeof maybe === 'object' && 'then' in maybe) ? await maybe : String(maybe);
        } else if (typeof resp?.response === 'string') {
          text = resp.response;
        } else {
          text = String(resp);
        }
      } catch (e) {
        text = String(resp);
      }
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
      console.debug('Attempting to call Gemini via official SDK with model:', modelName);

      const { model } = await buildClientAndModel();
      // Ensure prompt is a string
      const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

      // Use modern Gemini API with thinking support (for 2.5+ and 3.0+ models)
      // Thinking is automatically enabled for supported models and adjusts dynamically based on prompt complexity
      let response: any;
      try {
        const { zodToJsonSchema } = await import('zod-to-json-schema');
        // Cast to any to avoid TypeScript incompatibilities between zod versions/types.
        const schema = (zodToJsonSchema as any)(RecommendationSchema as any);

        // Modern API call structure for thinking models
        // Use model.generateContent with proper message format
        response = await model.generateContent({
          contents: [{
            role: 'user',
            parts: [{ text: promptText }]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema
          }
        });
      } catch (e) {
        // If zod-to-json-schema isn't available or something went wrong, fall back to existing behavior
        response = await model.generateContent(promptText);
      }

      // Extract text from the SDK response
      let text = '';
      try {
        const body = response?.response;
        if (body && typeof body.text === 'function') {
          const maybe = body.text();
          text = (maybe instanceof Promise) ? await maybe : maybe;
        } else if (typeof response?.response === 'string') {
          text = response.response;
        } else {
          text = JSON.stringify(response);
        }
      } catch (e) {
        console.warn('Failed to extract text from Gemini SDK response, falling back to JSON stringify', e);
        text = JSON.stringify(response);
      }

      if (!text) {
        console.warn('Gemini SDK returned no text; using heuristic fallback');
        throw new Error('Empty Gemini response');
      }

      // Extract JSON array from text. Only attempt JSON.parse when a JSON array is found.
      const first = text.indexOf('[');
      const last = text.lastIndexOf(']');
      if (first === -1 || last === -1 || last <= first) {
        console.warn('No JSON array found in Gemini output; skipping parse. Raw output:', text.substring(0, 200));
      } else {
        const jsonText = text.substring(first, last + 1);
        try {
          const parsed = JSON.parse(jsonText);
          const validated = RecommendationSchema.safeParse(parsed);
          if (validated.success) {
            // Return parsed items but importantly DO NOT include any TMDB id from Gemini.
            // We include release_year and reason so downstream enrichment can use year matching.
            return validated.data.map((p): RecommendationCandidate => ({
              title: p.title,
              media_type: p.media_type || 'movie',
              release_year: p.release_year,
              reason: p.reason,
            }));
          } else {
            console.warn('Gemini output failed Zod validation:', validated.error);
          }
        } catch (e) {
          console.error('Failed to parse Gemini JSON output:', e);
        }
      }
    } catch (e: any) {
      try { console.error('Gemini SDK Error:', JSON.stringify(e, Object.getOwnPropertyNames(e), 2)); } catch { console.error('Gemini SDK Error (string):', String(e)); }
      console.error('Gemini SDK error.response:', (e as any)?.response);
      console.error('Gemini SDK error.message:', (e as any)?.message);
      console.error('Gemini SDK error.status:', (e as any)?.status || (e as any)?.response?.status);
      console.warn('Gemini SDK failed; using heuristic fallback');
    }

    // Fallback heuristic
    try {
      const scored = (likedItems || []).slice().sort((a: MediaItemInput, b: MediaItemInput) => {
        const ratingA = a.voteAverage ?? a.vote_average ?? a.rating ?? 0;
        const ratingB = b.voteAverage ?? b.vote_average ?? b.rating ?? 0;
        return Number(ratingB) - Number(ratingA);
      });
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
      // Create model WITHOUT thinking config for pure JSON output
      const cfg = await ConfigService.getConfig();
      const rawKey = (cfg && cfg.geminiApiKey) ? String(cfg.geminiApiKey) : (process.env.GEMINI_API_KEY || '');
      const apiKey = rawKey.trim();
      if (!apiKey) throw new Error('Gemini API key not configured');

      const googleClient = new GoogleGenerativeAI(apiKey);
      const modelName = (cfg && cfg.geminiModel) ? String(cfg.geminiModel).trim() : 'gemini-2.0-flash';

      // Use model WITHOUT thinking config for JSON tasks
      const model = googleClient.getGenerativeModel({ model: modelName });
      console.debug(`[Gemini Ranking] Using model: ${modelName} for ${candidates.length} candidates (no thinking)`);

      // Format candidates for prompt
      const candidateList = candidates.slice(0, 30).map((c, i) =>
        `${i + 1}. "${c.title}" [${c.genres.join(', ')}] - Rating: ${c.voteAverage?.toFixed(1) || 'N/A'}\n   ${(c.overview || 'No description').substring(0, 100)}...`
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

      // Provide detailed mood descriptions for Gemini
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

      const prompt = `You are a movie recommender. Pick the ${limit} best titles from this list for a user.

${tasteContext}
${favoritesContext}
${genreContext}
${moodContext}

CANDIDATES:
${candidateList}

Return JSON array of ${limit} best picks: [{"tmdbId": 123, "title": "Name"}, ...]

ONLY JSON. NO TEXT.`;

      // Debug: log prompt size and first candidate
      console.debug(`[Gemini Ranking] Prompt length: ${prompt.length} chars, first candidate: ${candidates[0]?.title}`);

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 8000,  // Increased to prevent truncation
        },
      });

      // Debug: Check response structure and finish reason
      const candidate = result.response.candidates?.[0];
      console.debug(`[Gemini Ranking] Response candidates count: ${result.response.candidates?.length || 0}, finishReason: ${candidate?.finishReason || 'unknown'}`);

      const responseText = result.response.text();
      console.debug(`[Gemini Ranking] Raw response length: ${responseText.length} chars`);
      console.debug(`[Gemini Ranking] Response content (escaped): ${JSON.stringify(responseText).substring(0, 500)}`);

      // Try parsing directly first (responseMimeType should give clean JSON)
      let parsed: any[] = [];
      try {
        parsed = JSON.parse(responseText);
        console.debug(`[Gemini Ranking] Direct parse succeeded with ${parsed.length} items`);
      } catch (directParseError) {
        console.debug(`[Gemini Ranking] Direct parse failed: ${(directParseError as Error).message}`);
        // If direct parse fails, try regex extraction
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          console.warn('[Gemini Ranking] No valid JSON in response, first 300 chars:', JSON.stringify(responseText.substring(0, 300)));
          // Fallback: return top candidates by rating
          return candidates
            .sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0))
            .slice(0, limit)
            .map(c => ({ tmdbId: c.tmdbId, title: c.title, reason: 'Top rated' }));
        }
        parsed = JSON.parse(jsonMatch[0]);
      }

      console.debug(`[Gemini Ranking] Selected ${parsed.length} items from ${candidates.length} candidates`);

      return parsed.slice(0, limit);
    } catch (e: any) {
      console.error('[Gemini Ranking] Error:', e?.message || e);
      // Fallback: return top candidates by rating
      return candidates
        .sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0))
        .slice(0, limit)
        .map(c => ({ tmdbId: c.tmdbId, title: c.title, reason: 'Fallback recommendation' }));
    }
  }
}

