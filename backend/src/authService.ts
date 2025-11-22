
import { z } from 'zod';
import dotenv from 'dotenv';
import { JellyfinAuthResponse } from './types';

dotenv.config();

const JELLYFIN_URL = process.env.JELLYFIN_URL;

if (!JELLYFIN_URL) {
    throw new Error('JELLYFIN_URL must be set in your .env file');
}

// Zod schema for login request body
export const LoginSchema = z.object({
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
    serverUrl: z.string().url("Invalid server URL").optional(),
});

export class AuthService {
    public async authenticateUser(username: string, password: string, serverUrl?: string): Promise<JellyfinAuthResponse> {
        const targetJellyfinUrl = serverUrl || JELLYFIN_URL;
        
        try {
            const authHeaders = {
                'Content-Type': 'application/json',
                'X-Emby-Authorization': 'MediaBrowser Client="Jellyfin Recommender Backend", Device="Node.js", DeviceId="recommender-backend", Version="1.0"'
            };
            const authBody = {
                Username: username,
                Pw: password
            };

            const response = await axios.post<JellyfinAuthResponse>(
                `${targetJellyfinUrl}/Users/AuthenticateByName`,
                authBody,
                { headers: authHeaders, timeout: 10000 }
            );
            return response.data;
        } catch (error) {
            console.error('Error authenticating with Jellyfin:', error);
            throw error;
        }
    }
}
import axios from 'axios';
