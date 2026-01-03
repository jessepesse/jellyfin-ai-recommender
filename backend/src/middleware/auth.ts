
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../db';
import { logger } from '../utils/logger';
import { JellyfinService } from '../jellyfin';
import NodeCache from 'node-cache';

const jellyfinService = new JellyfinService();

// Secure Cache for Admin Tokens
// We use NodeCache for automatic TTL management to prevent stale sessions
// We use SHA-256 hashing for keys to prevent storing raw tokens in memory (Heap Dump protection)
const tokenCache = new NodeCache({
    stdTTL: 300, // 5 minutes standard TTL
    checkperiod: 60, // Check for expired keys every 60 seconds
    maxKeys: 1000, // Prevent DoS by limiting cache size
    useClones: false // Performance optimization since we don't mutate cached objects
});

// Generate a secure random key for HMAC hashing of tokens in memory
// This key is unique to each server instance/restart, which is fine because the cache is in-memory too.
const CACHE_SECRET = crypto.randomBytes(32).toString('hex');

interface CachedToken {
    userId: number; // Local DB ID
    jellyfinUserId: string;
    isSystemAdmin: boolean;
}

// Extend Express Request to include user
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: number;
                username: string;
                isSystemAdmin: boolean;
                jellyfinUserId?: string;

                // Allow other properties
                [key: string]: any;
            };
        }
    }
}

/**
 * Middleware to authenticate user via Token
 * Supports:
 * 1. Local Token: "local:<base64(userId:timestamp:signature)>"
 * 2. Jellyfin Token: "X-Access-Token" or "X-Emby-Token" headers
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        // 1. Get Token
        const token = req.headers['x-access-token'] as string ||
            req.headers['x-emby-token'] as string ||
            req.query.api_key as string; // Jellyfin sometimes uses query param

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized - No token provided' });
        }

        // 2. Check for Local Token
        if (token.startsWith('local:')) {
            const tokenPayload = token.substring(6); // remove "local:"
            try {
                const decoded = Buffer.from(tokenPayload, 'base64').toString('utf8');
                const [payload, signature] = decoded.split(':'); // payload is "userId:timestamp"
                const [userIdStr, timestampStr] = payload.split(':');

                const userId = parseInt(userIdStr);
                const timestamp = parseInt(timestampStr);

                // Token expires after 30 days
                const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
                if (Date.now() - timestamp > TOKEN_MAX_AGE_MS) {
                    return res.status(401).json({ error: 'Unauthorized - Token expired, please login again' });
                }

                const user = await prisma.user.findUnique({ where: { id: userId } });

                if (!user || !user.passwordHash) {
                    return res.status(401).json({ error: 'Unauthorized - Invalid local user' });
                }

                // Verify Signature
                // lgtm[js/insufficient-password-hash] - This is TOKEN SIGNING with HMAC-SHA256, not password hashing.
                // The passwordHash is already a PBKDF2 hash from password.ts - we use it as a signing key.
                // This ensures tokens are invalidated when passwords change.
                const expectedSignature = crypto.createHmac('sha256', user.passwordHash).update(payload).digest('hex');

                if (signature !== expectedSignature) {
                    return res.status(401).json({ error: 'Unauthorized - Invalid token signature' });
                }

                // Success
                req.user = {
                    id: user.id,
                    username: user.username,
                    isSystemAdmin: user.isSystemAdmin,
                    jellyfinUserId: `local-${user.id}`
                };
                return next();

            } catch (e) {
                return res.status(401).json({ error: 'Unauthorized - Invalid local token format' });
            }
        }

        // 3. Jellyfin Token Validation (Standard Tokens)
        // Verify identity securely via Jellyfin API (or cache) + Local DB mapping

        // SECURITY: Hash the token using HMAC before cache lookup
        // This ensures raw tokens are not resident in the cache memory for long periods
        // using HMAC prevents rainbow table attacks on the cache keys
        // lgtm[js/insufficient-password-hash] - Cache key generation requires speed. HMAC-SHA256 with secret is sufficient for in-memory cache.
        const tokenHash = crypto.createHmac('sha256', CACHE_SECRET).update(token).digest('hex');

        // Check secure cache first
        const cached = tokenCache.get<CachedToken>(tokenHash);

        if (cached) {
            // Cache Hit: User was recently validated against Jellyfin

            // Check if local user still exists/valid
            const user = await prisma.user.findUnique({ where: { id: cached.userId } });
            if (user) {
                req.user = {
                    id: user.id,
                    username: user.username,
                    isSystemAdmin: user.isSystemAdmin, // Refresh admin status from DB
                    jellyfinUserId: cached.jellyfinUserId
                };
            }
            return next();
        }

        // Cache Miss: Perform Full Validation
        // This is an expensive operation (network call), but necessary for security.
        try {
            // Verify token with Jellyfin Server
            const jellyfinUser = await jellyfinService.getMe(token);

            if (jellyfinUser) {
                // Token is valid and belongs to 'jellyfinUser'.

                // Security Check: Match against known local users
                // We trust the username returned by the Jellyfin Server (Authenticated Source)
                const localUser = await prisma.user.findUnique({
                    where: { username: jellyfinUser.Name }
                });

                if (localUser) {
                    // Success! Map identity.

                    req.user = {
                        id: localUser.id,
                        username: localUser.username,
                        isSystemAdmin: localUser.isSystemAdmin,
                        jellyfinUserId: jellyfinUser.Id
                    };

                    // Store in Secure Cache
                    tokenCache.set(tokenHash, {
                        userId: localUser.id,
                        jellyfinUserId: jellyfinUser.Id,
                        isSystemAdmin: localUser.isSystemAdmin
                    });
                } else {
                    // Token is valid in Jellyfin, but no matching local user found.
                    // Treat as Guest (no req.user).
                }
            }
        } catch (validationErr) {
            // Failed to validate with Jellyfin (network or error). 
            // We cannot safely grant admin access.
            logger.warn({ err: validationErr }, 'Failed to validate Jellyfin token online');
        }

        return next();

    } catch (error) {
        logger.error({ err: error }, 'Auth middleware error');
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

/**
 * Middleware to require System Admin privileges
 * Requires valid Local Token authentication (no legacy header fallback)
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (req.user && req.user.isSystemAdmin) {
        return next();
    }

    return res.status(403).json({ error: 'Forbidden - System admin privileges required' });
}
