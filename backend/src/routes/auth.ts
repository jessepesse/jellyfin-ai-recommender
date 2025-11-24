import { Router } from 'express';
import { z } from 'zod';
import { AuthService, LoginSchema } from '../authService';
import { LoginResponse } from '../types';
import { validateLogin } from '../middleware/validators';

const authRouter = Router();
const authService = new AuthService();

// POST /api/auth/login
authRouter.post('/login', validateLogin, async (req, res) => {
    try {
        // Zod validation
        const { username, password, serverUrl } = LoginSchema.parse(req.body);

        const jellyfinAuth = await authService.authenticateUser(username, password, serverUrl);

        // After successful auth, read back the config to get the working URL that was persisted
        const ConfigServiceModule = await import('../services/config');
        const ConfigService = ConfigServiceModule.default;
        const cfg = await ConfigService.getConfig();
        const workingUrl = cfg.jellyfinUrl;

        // Return the auth response + the working server URL for frontend storage
        res.json({ 
            success: true, 
            jellyfinAuth,
            serverUrl: workingUrl 
        } as LoginResponse);

    } catch (error: any) {
        if (error instanceof z.ZodError) {
            console.error('Validation error for login:', error.issues);
            return res.status(400).json({ success: false, message: 'Validation failed', errors: error.issues });
        }
        console.error('Error during backend Jellyfin authentication:', error);
        if (error.response && error.response.status === 401) {
            return res.status(401).json({ success: false, message: 'Invalid Jellyfin username or password.' } as LoginResponse);
        }
        // Generic error message for other issues
        res.status(500).json({ success: false, message: 'An unexpected error occurred during authentication.' } as LoginResponse);
    }
});

export default authRouter;

