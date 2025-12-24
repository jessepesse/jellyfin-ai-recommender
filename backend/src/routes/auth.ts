import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AuthService, LoginSchema } from '../authService';
import { LoginResponse } from '../types';
import { validateLogin } from '../middleware/validators';
import { getErrorMessage, getErrorStatusCode, logError } from '../utils/errors';

const authRouter = Router();
const authService = new AuthService();

// POST /api/auth/login
authRouter.post('/login', validateLogin, async (req: Request, res: Response) => {
    try {
        // Zod validation
        const { username, password, serverUrl } = LoginSchema.parse(req.body);

        const jellyfinAuth = await authService.authenticateUser(username, password, serverUrl);

        // After successful auth, read back the config to get the working URL that was persisted
        const ConfigServiceModule = await import('../services/config');
        const ConfigService = ConfigServiceModule.default;
        const cfg = await ConfigService.getConfig();
        const workingUrl = cfg.jellyfinUrl;

        // Extract admin status from Jellyfin Policy
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

