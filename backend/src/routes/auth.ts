import { Router } from 'express';
import { z } from 'zod';
import { AuthService, LoginSchema } from '../authService';
import { LoginResponse } from '../types';

const authRouter = Router();
const authService = new AuthService();

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
    try {
        // Zod validation
        const { username, password, serverUrl } = LoginSchema.parse(req.body);

        const jellyfinAuth = await authService.authenticateUser(username, password, serverUrl);

        // For now, return the JellyfinAuthResponse directly.
        // Future security enhancements might involve HTTP-only cookies or server-side sessions.
        res.json({ success: true, jellyfinAuth } as LoginResponse);

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

