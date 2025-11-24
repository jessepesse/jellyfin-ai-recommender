export interface JellyfinItem {
    Id: string;
    Name: string;
    Type?: string;
    Genres?: string[];
    CommunityRating?: number;
    Overview?: string;
    PremiereDate?: string;
    ProductionYear?: number;
    ImageTags?: {
        Primary?: string;
    };
    imageUrl?: string;
    ProviderIds?: {
        Tmdb?: string | number;
        tmdb?: string | number;
        Imdb?: string;
        imdb?: string;
    };
    UserData?: {
        Played?: boolean;
        LastPlayedDate?: string;
    };
}

export interface JellyfinLibrary {
    Id: string;
    Name: string;
}

export interface JellyfinUser {
    Id: string;
    Name: string;
}

export interface JellyfinAuthResponse {
    AccessToken: string;
    User: JellyfinUser;
}

export interface LoginResponse {
    success: boolean;
    message?: string;
    jellyfinAuth?: JellyfinAuthResponse;
    serverUrl?: string;  // The working Jellyfin URL (after candidate testing)
}

export interface JellyfinLibrary {
    Id: string;
    Name: string;
}

export interface JellyfinUser {
    Id: string;
    Name: string;
}

export interface JellyfinAuthResponse {
    AccessToken: string;
    User: JellyfinUser;
    // Potentially add other relevant auth properties if needed, e.g., ServerId, SessionId
}
