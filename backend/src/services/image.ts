import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import stream from 'stream';
import { validateRequestUrl, validateSafeUrl } from '../utils/ssrf-protection';

const pipeline = promisify(stream.pipeline);

/**
 * ImageService: Handles downloading and storing media images locally
 * 
 * Architecture:
 * - Downloads images from external sources (Jellyseerr, TMDB)
 * - Stores in /app/images directory (Docker volume)
 * - Returns local URL paths for database storage
 * - Prevents broken links when Jellyseerr IP changes
 */
export class ImageService {
    private static imageDir = process.env.IMAGE_DIR || '/app/images';

    /**
     * Ensure the images directory exists
     */
    static async ensureImageDir(): Promise<void> {
        if (!fs.existsSync(this.imageDir)) {
            fs.mkdirSync(this.imageDir, { recursive: true });
            console.log(`[ImageService] Created images directory: ${this.imageDir}`);
        }
    }

    /**
     * Generate standardized filename for media images
     * Format: {mediaType}_{tmdbId}_{type}.jpg
     * 
     * @param tmdbId - TMDB ID of the media
     * @param mediaType - 'movie' or 'tv'
     * @param type - 'poster' or 'backdrop'
     * @returns Filename string
     */
    static getLocalFilename(tmdbId: number, mediaType: string, type: 'poster' | 'backdrop'): string {
        return `${mediaType}_${tmdbId}_${type}.jpg`;
    }

    /**
     * Get the local public URL path for an image
     * 
     * @param tmdbId - TMDB ID of the media
     * @param mediaType - 'movie' or 'tv'
     * @param type - 'poster' or 'backdrop'
     * @returns URL path (e.g., /images/movie_123_poster.jpg)
     */
    static getLocalPath(tmdbId: number, mediaType: string, type: 'poster' | 'backdrop'): string {
        const filename = this.getLocalFilename(tmdbId, mediaType, type);
        return `/images/${filename}`;
    }

    /**
     * Check if an image already exists locally
     * 
     * @param tmdbId - TMDB ID of the media
     * @param mediaType - 'movie' or 'tv'
     * @param type - 'poster' or 'backdrop'
     * @returns True if file exists
     */
    static imageExists(tmdbId: number, mediaType: string, type: 'poster' | 'backdrop'): boolean {
        const filename = this.getLocalFilename(tmdbId, mediaType, type);
        const filepath = path.join(this.imageDir, filename);
        return fs.existsSync(filepath);
    }

    /**
     * Download an image from URL and save to local storage
     * 
     * @param url - Source URL (can be external or proxy URL)
     * @param filename - Target filename (without path)
     * @param headers - Optional headers (e.g., X-Api-Key for Jellyseerr)
     * @returns Local URL path on success, null on failure
     */
    static async download(url: string, filename: string, headers?: Record<string, string>): Promise<string | null> {
        try {
            await this.ensureImageDir();

            const filepath = path.join(this.imageDir, filename);

            // If file already exists, return the local path
            if (fs.existsSync(filepath)) {
                console.log('[ImageService] Image already exists at path:', filename);
                return `/images/${filename}`;
            }

            // SSRF Protection: Handle proxy URLs safely
            let downloadUrl: string;
            if (url.startsWith('/api/proxy/image')) {
                // For proxy URLs with query parameters (e.g., ?type=poster&path=...)
                // Construct full backend URL
                const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
                downloadUrl = `${backendUrl}${url}`;
            } else {
                // For external URLs, validate directly
                downloadUrl = url;
            }

            // SSRF Protection: Validate URL before making request
            const validatedUrl = validateRequestUrl(downloadUrl);
            const safeUrl = validateSafeUrl(validatedUrl);
            // Security: Use separate arguments to prevent format string injection
            console.log('[ImageService] Downloading image to file:', filename);

            // Download image stream with validated URL
            // codeql[js/request-forgery] - Image download from validated sources (TMDB, Jellyseerr, local IPs), validated by validateSafeUrl
            const response = await axios.get(safeUrl, {
                responseType: 'stream',
                headers: headers || {},
                timeout: 30000, // 30 second timeout
            });

            // Save to disk
            await pipeline(response.data, fs.createWriteStream(filepath));

            console.log('[ImageService] Successfully downloaded image to file:', filename);
            return `/images/${filename}`;
        } catch (error: any) {
            // Security: Sanitize both URL and error message to prevent format string injection
            const safeUrl = String(url).substring(0, 200); // Limit URL length for logging
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[ImageService] Failed to download URL:`, safeUrl, errorMsg);
            return null;
        }
    }

    /**
     * Download poster and backdrop for a media item
     * 
     * @param tmdbId - TMDB ID
     * @param mediaType - 'movie' or 'tv'
     * @param posterUrl - Current poster URL (external or proxy)
     * @param backdropUrl - Current backdrop URL (external or proxy)
     * @param headers - Optional headers for download
     * @returns Object with local poster and backdrop URLs
     */
    static async downloadMediaImages(
        tmdbId: number,
        mediaType: string,
        posterUrl?: string | null,
        backdropUrl?: string | null,
        headers?: Record<string, string>
    ): Promise<{ posterUrl: string | null; backdropUrl: string | null }> {
        const result = {
            posterUrl: posterUrl || null,
            backdropUrl: backdropUrl || null,
        };

        // Download poster if external URL provided
        if (posterUrl && (posterUrl.startsWith('http') || posterUrl.startsWith('/api/proxy'))) {
            const filename = this.getLocalFilename(tmdbId, mediaType, 'poster');
            const localPath = await this.download(posterUrl, filename, headers);
            if (localPath) {
                result.posterUrl = localPath;
            }
        }

        // Download backdrop if external URL provided
        if (backdropUrl && (backdropUrl.startsWith('http') || backdropUrl.startsWith('/api/proxy'))) {
            const filename = this.getLocalFilename(tmdbId, mediaType, 'backdrop');
            const localPath = await this.download(backdropUrl, filename, headers);
            if (localPath) {
                result.backdropUrl = localPath;
            }
        }

        return result;
    }

    /**
     * Delete an image file from local storage
     * 
     * @param tmdbId - TMDB ID
     * @param mediaType - 'movie' or 'tv'
     * @param type - 'poster' or 'backdrop'
     */
    static deleteImage(tmdbId: number, mediaType: string, type: 'poster' | 'backdrop'): void {
        const filename = this.getLocalFilename(tmdbId, mediaType, type);
        const filepath = path.join(this.imageDir, filename);
        
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log(`[ImageService] Deleted: ${filename}`);
        }
    }
}
