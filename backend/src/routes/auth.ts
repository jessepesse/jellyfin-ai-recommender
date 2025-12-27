import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AuthService, LoginSchema } from '../authService';
import { LoginResponse } from '../types';
import { validateLogin } from '../middleware/validators';
import { getErrorMessage, getErrorStatusCode, logError } from '../utils/errors';
import prisma from '../db';
import { verifyPassword, hashPassword } from '../utils/password';
import crypto from 'crypto';
import { logger } from '../utils/logger';

const authRouter = Router();
const authService = new AuthService();

// POST /api/auth/login
authRouter.post('/login', validateLogin, async (req: Request, res: Response) => {
    try {
        // Zod validation
        const { username, password, serverUrl } = LoginSchema.parse(req.body);

        let jellyfinAuth: any = null;
        let isLocalAdmin = false;
        let userId: number | undefined;

        // 1. Check for Local Admin / Cached Credentials
        logger.info(`[Auth] Attempting login for user: ${username}`);
        const localUser = await prisma.user.findUnique({ where: { username } });

        if (localUser && localUser.passwordHash) {
            // Verify password locally
            const isValid = verifyPassword(password, localUser.passwordHash);
            if (isValid) {
                logger.info(`[Auth] Local authentication successful for ${username} (Offline/Hybrid Mode)`);
                isLocalAdmin = localUser.isSystemAdmin;
                userId = localUser.id;

                // Construct a mock Jellyfin auth response for frontend compatibility
                // If it's a pure local admin, we generate a special local token
                // Format: local:<base64(userId:timestamp:signature)>
                // Signature = hmac(userId:timestamp, passwordHash)
                const timestamp = Date.now();
                const payload = `${localUser.id}:${timestamp}`;
                const signature = crypto.createHmac('sha256', localUser.passwordHash).update(payload).digest('hex');
                const tokenPayload = Buffer.from(`${payload}:${signature}`).toString('base64');
                const localToken = `local:${tokenPayload}`;

                jellyfinAuth = {
                    User: {
                        Id: `local-${localUser.id}`, // Mock UUID
                        Name: localUser.username,
                        Policy: { IsAdministrator: localUser.isSystemAdmin }
                    },
                    AccessToken: localToken,
                    ServerId: 'local-server'
                };
            } else {
                logger.warn(`[Auth] Local password did not match for ${username}, falling back to Jellyfin API`);
            }
        }

        // 2. If local auth failed or didn't exist, try Jellyfin API
        if (!jellyfinAuth) {
            jellyfinAuth = await authService.authenticateUser(username, password, serverUrl);

            // 3. Sync/Cache credentials on success
            const isAdmin = jellyfinAuth.User.Policy?.IsAdministrator ?? false;

            // Upsert user and cache password hash
            try {
                const passwordHash = hashPassword(password);
                const user = await prisma.user.upsert({
                    where: { username },
                    update: {
                        passwordHash,
                        // Only auto-promote to admin if Jellyfin says so (and not already disabled locally?)
                        // Actually, let's sync matches Jellyfin status primarily.
                        isSystemAdmin: isAdmin
                    },
                    create: {
                        username,
                        passwordHash,
                        isSystemAdmin: isAdmin,
                        movieProfile: "New user",
                        tvProfile: "New user"
                    }
                });
                userId = user.id;
                logger.info(`[Auth] Synced credentials for ${username} (ID: ${userId})`);
            } catch (syncErr) {
                logger.error({ err: syncErr }, '[Auth] Failed to sync local credentials');
            }
        }

        // After successful auth, read back the config to get the working URL that was persisted
        const ConfigServiceModule = await import('../services/config');
        const ConfigService = ConfigServiceModule.default;
        const cfg = await ConfigService.getConfig();
        const workingUrl = cfg.jellyfinUrl;

        // Extract admin status
        const isAdmin = jellyfinAuth.User.Policy?.IsAdministrator ?? false;

        // Return the auth response + the working server URL + admin status for frontend storage
        res.json({
            success: true,
            jellyfinAuth,
            serverUrl: workingUrl,
            isAdmin
        } as LoginResponse);

    } catch (error: unknown) {
        if (error instanceof z.ZodError) {
            console.error('Validation error for login:', error.issues);
            return res.status(400).json({ success: false, message: 'Validation failed', errors: error.issues });
        }

        logError(error, 'auth/login');
        const statusCode = getErrorStatusCode(error);

        if (statusCode === 401) {
            return res.status(401).json({ success: false, message: 'Invalid Jellyfin username or password.' } as LoginResponse);
        }

        // Generic error message for other issues
        res.status(500).json({ success: false, message: 'An unexpected error occurred during authentication.' } as LoginResponse);
    }
});

export default authRouter;

