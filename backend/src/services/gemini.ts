import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { z } from 'zod';
import ConfigService from './config';
import { MediaItemInput, UserData, RecommendationCandidate, RecommendationFilters } from '../types';

// Default model with thinking support enabled
// Gemini 2.5+ and 3.0+ models automatically use internal thinking for improved reasoning
// Thinking dynamically adjusts based on prompt complexity
const modelName = 'gemini-2.5-flash-lite';
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
  const model = client.getGenerativeModel({ model: modelNameFromCfg });

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
### TASK
Based on the "Taste Analysis", recommend exactly 40 NEW and UNDISCOVERED items.
The user wants fresh recommendations they have NOT seen before.

- TYPE: ${mediaType}
- GENRE: ${genreNote}${moodNote}

---

### 🚫 MANDATORY EXCLUSION LIST (${exclusionCount} items)
The following items are already in the user's library or watchlist.
**CRITICAL: You MUST NOT recommend ANY title from this list.**

| Title | Year |
|-------|------|
${exclusionSection}

---

### ⚠️ FINAL VALIDATION RULES (ABSOLUTE - NO EXCEPTIONS)

1. **CHECK EVERY SINGLE RECOMMENDATION AGAINST THE EXCLUSION LIST ABOVE.**
2. **If a title (or similar variation) appears in the list, DELETE IT and find another.**
3. **NEVER suggest a Movie/TV Show that the user has already watched.**
4. **ensure release years are accurate.**
5. **Prioritize variety.**

---

### OUTPUT FORMAT
Respond ONLY with a JSON array of objects with keys: title, media_type (movie|tv), release_year (YYYY), reason.
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
}

