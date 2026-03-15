import { GoogleGenAI, type GenerateContentConfig } from '@google/genai';
import OpenAI from 'openai';
import ConfigService from './config';
import { MediaItemInput } from '../types';

// Gemini 2.5+ and 3.0+ models automatically use internal thinking for improved reasoning
// Thinking dynamically adjusts based on prompt complexity
const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';

// Unified AI Client Bundle that works with both Google AI and OpenRouter
export interface AIClientBundle {
  provider: 'google' | 'openrouter';
  modelName: string;
  // Google GenAI SDK (new)
  googleClient?: GoogleGenAI;
  // Per-call model config (thinkingConfig etc.)
  modelConfig?: GenerateContentConfig;
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
    // Google AI Direct setup (new @google/genai SDK)
    const rawKey = cfg.geminiApiKey ? String(cfg.geminiApiKey) : (process.env.GEMINI_API_KEY || '');
    const apiKey = rawKey.trim();

    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const googleClient = new GoogleGenAI({ apiKey });

    // Configure thinking level for Gemini 3 Flash/Pro models
    const isGemini3Model = modelNameFromCfg.includes('gemini-3');
    const isProModel = modelNameFromCfg.includes('-pro');
    const thinkingLevel = isProModel ? 'high' : 'medium';

    const modelConfig: GenerateContentConfig = isGemini3Model ? {
      thinkingConfig: {
        thinkingBudget: thinkingLevel === 'high' ? 8192 : 4096
      }
    } : {};

    return {
      provider: 'google',
      modelName: modelNameFromCfg,
      googleClient,
      modelConfig
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
  } else if (client.provider === 'google' && client.googleClient) {
    const config: GenerateContentConfig = {
      ...client.modelConfig,
      ...(options?.json ? {
        responseMimeType: 'application/json',
        responseSchema: options.jsonSchema as any
      } : {})
    };

    const response = await client.googleClient.models.generateContent({
      model: client.modelName,
      contents: prompt,
      config,
    });

    return response.text ?? '';
  }

  throw new Error('No AI client configured');
}


export class GeminiService {
  // Summarize a user's taste profile using AI (compact text)
  // Works with both Google AI and OpenRouter
  public static async summarizeProfile(username: string, seedItems: MediaItemInput[], type: 'movie' | 'tv'): Promise<string> {
    try {
      const client = await buildClientAndModel();
      const items = (seedItems || []).slice(0, 80).map((s: MediaItemInput) => {
        const title = s.title || s.name || s.Title || '';
        if (!title) return '';

        const rawYear = s.release_year || s.releaseYear || s.releaseDate || s.release_date || s.year || '';
        const year = String(rawYear || '').substring(0, 4);

        // Extract genres from various possible field names via any-cast
        const sAny = s as Record<string, unknown>;
        const genres = sAny.genres || sAny.Genres || sAny.genre_names;
        const genreStr = Array.isArray(genres) ? genres.join(', ') : '';

        const rating = s.voteAverage || s.vote_average;
        const ratingStr = typeof rating === 'number' ? ` ★${rating.toFixed(1)}` : '';

        let line = `- "${title}"`;
        if (year) line += ` (${year})`;
        if (genreStr) line += ` [${genreStr}]`;
        line += ratingStr;
        return line;
      }).filter(Boolean);

      const prompt = `WATCH HISTORY (${type === 'movie' ? 'movies' : 'TV shows'}):
${items.join('\n')}

Analyze this ${type} watch history. Generate 3 short, insightful but casual bullet points describing their specific taste (themes, moods, genres). Use the genre and rating data above for accuracy.

Return ONLY plain text bullet points, no markdown formatting, no headers. Keep each point under 20 words.`;

      const text = await generateAIContent(client, prompt);
      return (text || '').trim().substring(0, 2000);
    } catch (e) {
      console.warn('summarizeProfile failed', e);
      return '';
    }
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
      requestedYearRange?: string;
      blockedItems?: Array<{ title: string; genres: string[] }>;
    },
    limit: number = 10
  ): Promise<Array<{ tmdbId: number; title: string; reason: string }>> {
    if (candidates.length === 0) return [];

    try {
      const client = await buildClientAndModel();
      console.debug(`[AI Ranking] Using provider: ${client.provider}, model: ${client.modelName} for ${candidates.length} candidates`);

      // Format candidates for prompt
      const candidateList = candidates.slice(0, 30).map((c, i) =>
        `${i + 1}. [ID:${c.tmdbId}] "${c.title}" [${c.genres.join(', ')}] ★${c.voteAverage?.toFixed(1) || 'N/A'}\n   ${(c.overview || 'No description').substring(0, 150)}`
      ).join('\n');

      // Build context lines, filtering out empty ones
      const contextLines: string[] = [];
      if (userContext.tasteProfile) contextLines.push(`Taste profile: ${userContext.tasteProfile}`);
      if (userContext.recentFavorites?.length) contextLines.push(`Recent favorites: ${userContext.recentFavorites.slice(0, 5).join(', ')}`);
      if (userContext.requestedGenre) contextLines.push(`Requested genre: ${userContext.requestedGenre}`);
      if (userContext.requestedYearRange) contextLines.push(`Requested year range: ${userContext.requestedYearRange}`);

      // Detailed mood descriptions
      const moodDescriptions: Record<string, string> = {
        'mind-bending': 'MIND-BENDING: Complex plots, twist endings, psychological themes, surreal, nonlinear timelines',
        'dark': 'DARK & GRITTY: Noir, dystopian, crime, violence, morally ambiguous, intense',
        'adrenaline': 'ADRENALINE: Action-packed, thrilling, car chases, explosions, heists, high stakes',
        'chill': 'CHILL & COMFORT: Relaxing, heartwarming, slice of life, feel-good, cozy, low-stakes',
        'feel-good': 'FEEL-GOOD: Uplifting, happy endings, comedy, romance, optimistic, warm',
        'tearjerker': 'TEARJERKER: Emotional, tragic, loss, grief, moving, bittersweet',
        'visual': 'VISUAL/EPIC: Stunning visuals, epic scope, fantasy worlds, cinematographic masterpiece',
      };
      if (userContext.requestedMood && moodDescriptions[userContext.requestedMood]) {
        contextLines.push(`Requested mood: ${moodDescriptions[userContext.requestedMood]}`);
      }

      // Build blocked items context for negative signals
      let blockedContext = '';
      if (userContext.blockedItems && userContext.blockedItems.length > 0) {
        const blockedList = userContext.blockedItems.slice(0, 20).map(b =>
          `- "${b.title}" [${b.genres.join(', ')}]`
        ).join('\n');
        blockedContext = `\nBLOCKED ITEMS (user rejected these):\n${blockedList}\n`;
      }

      // Gemini 3 optimized: data first, task middle, constraints last
      const prompt = `USER CONTEXT:
${contextLines.length > 0 ? contextLines.join('\n') : 'No specific preferences provided.'}
${blockedContext}
CANDIDATES (${candidates.length} titles):
${candidateList}

Select the ${limit} best matches for this user from the candidates above. For each pick, provide a short reason why it fits.

Return ONLY a JSON array: [{"tmdbId": 123, "title": "Name", "reason": "Why it fits"}, ...]
Do NOT include titles not in the candidate list.${blockedContext ? ' Avoid titles similar in theme/genre to the blocked items.' : ''} Output must be valid JSON, no markdown.`;

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

      // Gemini 3 optimized: data first, task middle, constraints last
      const prompt = `WATCH HISTORY (${mediaType === 'movie' ? 'movies' : 'TV shows'}, ${watchHistory.length} items):
${historyList}

Analyze this watch history and identify preferences. Return a JSON object with these fields:
- tasteProfile: One engaging sentence describing their taste
- genres: 2-4 standard genre names (Action, Comedy, Drama, Thriller, Horror, Romance, Sci-Fi, Fantasy, Documentary, Crime, Mystery, Animation)
- keywords: 4-8 simple thematic keywords for TMDB search
- yearRange: [startYear, endYear] if era preference exists, otherwise null
- minRating: Minimum rating threshold (6.0-8.0)

Use ONLY simple TMDB-compatible keywords like "heist", "dystopia", "noir", "revenge", "time travel", "serial killer". Do NOT use complex phrases like "prestige drama" or "character study".
Return ONLY valid JSON, no markdown.`;

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

      // Gemini 3 optimized: data first, task middle, constraints last
      const prompt = `USER TASTE:
"${userTaste.tasteProfile}"
Preferred genres: ${userTaste.genres.join(', ')}
Thematic interests: ${userTaste.keywords.join(', ')}

CANDIDATE POOL (${candidates.length} titles):
${candidateList}

Select the ${limit} best matches for this user. For each, provide a 1-sentence reason why it fits their taste. Prioritize quality (★7.0+), genre match, and a mix of classics and newer releases.

Return ONLY a valid JSON array: [{"tmdbId": 123, "title": "Example", "reason": "Why it fits"}, ...]
Do NOT include titles not in the candidate pool. Output must be valid JSON, no markdown.`;

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
    limit: number = 10,
    tasteProfile?: string,
    blocklistItems?: Array<{ title: string; genres: string[] }>
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

      // Build blocklist context with metadata when available
      let blocklistContext = '(none)';
      if (blocklistItems && blocklistItems.length > 0) {
        blocklistContext = blocklistItems.slice(0, 30).map(b =>
          `- "${b.title}" [${b.genres.join(', ')}]`
        ).join('\n');
      }

      // Gemini 3 optimized: data first, task middle, constraints last
      const prompt = `${tasteProfile ? `USER TASTE PROFILE:\n${tasteProfile}\n\n` : ''}BLOCKED ITEMS (user rejected these):
${blocklistContext}

CURATOR'S PICKS (${filtered.length} candidates):
${picksList}

From these candidates, select the TOP ${limit} that best match the user's taste profile. Prefer picks with compelling curator reasoning and high quality.

Return ONLY a valid JSON array: [{"tmdbId": 123, "title": "Example"}, ...]
Do NOT select titles similar in theme/genre to the blocked items above. Output must be valid JSON, no markdown.`;

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
