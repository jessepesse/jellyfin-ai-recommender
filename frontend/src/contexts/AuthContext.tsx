import { createContext, useState, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';

// Define the shape of the Jellyfin user returned by our backend
interface User {
  id: string;
  name: string;
}

// Define the shape of the authentication state and actions
interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  token: string | null;
  serverUrl: string | null;
  login: (username: string, password: string, serverUrl?: string) => Promise<boolean>;
  logout: () => void;
}

// Create the Auth Context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Define the AuthProvider component
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  // Attempt to load auth state from local storage on initial render
  useEffect(() => {
    const storedToken = localStorage.getItem('jellyfin_token');
    const storedUser = localStorage.getItem('jellyfin_user');
    const storedServer = localStorage.getItem('jellyfin_server');
    if (storedToken && storedUser) {
      setToken(storedToken);
      try {
        setUser(JSON.parse(storedUser));
        if (storedServer) setServerUrl(storedServer);
        setIsAuthenticated(true);
      } catch (e) {
        console.error("Failed to parse stored user data:", e);
        logout(); // Clear invalid stored data
      }
    }
  }, []);

  const login = async (username: string, password: string, serverUrl?: string): Promise<boolean> => {
    try {
      // Use relative path /api (proxied by Vite in dev, Nginx in production)
      // Or use VITE_BACKEND_URL if explicitly set for custom backend
      const baseUrl = import.meta.env.VITE_BACKEND_URL 
        ? import.meta.env.VITE_BACKEND_URL + '/api'
        : '/api';
      const response = await axios.post(`${baseUrl}/auth/login`, {
        username,
        password,
        serverUrl,
      });

      if (response.data.success && response.data.jellyfinAuth) {
        const jellyfinAuth = response.data.jellyfinAuth;
        const newUser: User = {
          id: jellyfinAuth.User.Id,
          name: jellyfinAuth.User.Name,
        };
        const newToken = jellyfinAuth.AccessToken;
        // Priority: backend-verified URL > user-provided > env var
        // Backend returns the working URL after testing candidates
        const newServer = response.data.serverUrl || serverUrl || import.meta.env.VITE_JELLYFIN_URL || null;

        setUser(newUser);
        setToken(newToken);
        setIsAuthenticated(true);
        setServerUrl(newServer);

        // Store in local storage for persistence
        localStorage.setItem('jellyfin_token', newToken);
        localStorage.setItem('jellyfin_user', JSON.stringify(newUser));
        // Always store server URL (backend ensures we have a working one)
        if (newServer) {
          localStorage.setItem('jellyfin_server', newServer);
        }
        
        // Store password in sessionStorage for automatic token refresh
        // sessionStorage is cleared when browser tab is closed (more secure than localStorage)
        sessionStorage.setItem('jellyfin_password', password);
        
        return true;
      } else {
        console.error('Login failed:', response.data.message);
        return false;
      }
    } catch (error: any) {
      console.error('Login request error:', error.response?.data?.message || error.message);
      // Optionally re-throw or handle error in UI
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setIsAuthenticated(false);
    setServerUrl(null);
    localStorage.removeItem('jellyfin_token');
    localStorage.removeItem('jellyfin_user');
    localStorage.removeItem('jellyfin_server');
    sessionStorage.removeItem('jellyfin_password');
  };

  const authContextValue: AuthContextType = {
    user,
    isAuthenticated,
    token,
    serverUrl,
    login,
    logout,
  };

  return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
};

// Custom hook to use the Auth Context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

