import axios from 'axios';
import dotenv from 'dotenv';
import { JellyfinItem, JellyfinLibrary } from './types'; // Removed JellyfinAuthResponse, JellyfinUser as authenticateUser moved

dotenv.config();

const JELLYFIN_URL = process.env.JELLYFIN_URL;
// JELLYFIN_API_KEY is now only for server-to-server functionality that might not be user-specific.
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;

if (!JELLYFIN_URL) {
    throw new Error('JELLYFIN_URL must be set in your .env file');
}

// apiClient can be used for calls that require a static API key, or no authentication.
// For user-authenticated calls, 'axios' will be used directly with 'X-Emby-Token' headers.
const apiClient = axios.create({
    baseURL: JELLYFIN_URL,
    // Add API key authorization here if there are service-level calls that need it
    // headers: {
    //     'X-Emby-Authorization': `MediaBrowser ApiKey="${JELLYFIN_API_KEY}"`,
    // },
});


export class JellyfinService {

    // Removed authenticateUser as it's now in AuthService

    public async getLibraries(accessToken: string): Promise<JellyfinLibrary[]> {
        try {
            const headers = {
                'X-Emby-Token': accessToken
            };
            const response = await axios.get<any>(`${JELLYFIN_URL}/Library/VirtualFolders`, { headers, timeout: 10000 });
            return response.data.Items || [];
        } catch (error) {
            console.error('Error fetching Jellyfin libraries:', error);
            // Return empty array on failure to allow callers to continue defensively
            return [];
        }
    }

    public async getItems(userId: string, accessToken: string, libraryId: string, searchTerm?: string): Promise<JellyfinItem[]> {
        try {
            const headers = {
                'X-Emby-Token': accessToken
            };

            const params: any = {
                ParentId: libraryId,
                Recursive: true,
                IncludeItemTypes: 'Movie,Series',
                Fields: 'Genres,CommunityRating,Overview,ImageTags',
            };

            if (searchTerm) {
                params.SearchTerm = searchTerm;
            }

            const response = await axios.get<any>(`${JELLYFIN_URL}/Users/${userId}/Items`, { headers, params, timeout: 10000 });
            
            const items: JellyfinItem[] = response.data.Items;

            return items.map(item => {
                if (item.ImageTags?.Primary) {
                    item.imageUrl = `${JELLYFIN_URL}/Items/${item.Id}/Images/Primary?maxHeight=300&tag=${item.ImageTags.Primary}`;
                }
                return item;
            });

        } catch (error) {
            console.error(`Error fetching items from library ${libraryId}:`, error);
            throw error;
        }
    }

        public async getUserHistory(userId: string, accessToken: string, limit: number = 200): Promise<JellyfinItem[]> {
            try {
                const headers = { 'X-Emby-Token': accessToken };
                const params: any = {
                    Recursive: true,
                    IncludeItemTypes: 'Movie,Series,Episode',
                    Filters: 'IsPlayed',
                    Limit: limit,
                    Fields: 'Genres,CommunityRating,Overview,ImageTags',
                };
                const response = await axios.get<any>(`${JELLYFIN_URL}/Users/${userId}/Items`, { headers, params, timeout: 15000 });
                const items: JellyfinItem[] = response.data.Items || [];
                return items.map(item => {
                    if (item.ImageTags?.Primary) {
                        item.imageUrl = `${JELLYFIN_URL}/Items/${item.Id}/Images/Primary?maxHeight=300&tag=${item.ImageTags.Primary}`;
                    }
                    return item;
                });
            } catch (error) {
                console.error('Error fetching user history from Jellyfin:', error);
                return [];
            }
        }
}
