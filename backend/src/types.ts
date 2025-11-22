export interface JellyfinItem {
    Id: string;
    Name: string;
    Genres?: string[];
    CommunityRating?: number;
    Overview?: string;
    PremiereDate?: string;
    ImageTags?: {
        Primary?: string;
    };
    imageUrl?: string;
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
}
export interface JellyfinItem {
    Id: string;
    Name: string;
    Genres?: string[];
    CommunityRating?: number;
    Overview?: string;
    PremiereDate?: string;
    ImageTags?: {
        Primary?: string;
    };
    imageUrl?: string;
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

export interface LoginResponse {
    success: boolean;
    message?: string;
    jellyfinAuth?: JellyfinAuthResponse;
}
