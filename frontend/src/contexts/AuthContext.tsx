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

  // Attempt to load auth state from local storage on initial render
  useEffect(() => {
    const storedToken = localStorage.getItem('jellyfin_token');
    const storedUser = localStorage.getItem('jellyfin_user');
    if (storedToken && storedUser) {
      setToken(storedToken);
      try {
        setUser(JSON.parse(storedUser));
        setIsAuthenticated(true);
      } catch (e) {
        console.error("Failed to parse stored user data:", e);
        logout(); // Clear invalid stored data
      }
    }
  }, []);

  const login = async (username: string, password: string, serverUrl?: string): Promise<boolean> => {
    try {
      // Use VITE_BACKEND_URL from environment variables for the frontend
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const response = await axios.post(`${backendUrl}/api/auth/login`, {
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

        setUser(newUser);
        setToken(newToken);
        setIsAuthenticated(true);

        // Store in local storage for persistence
        localStorage.setItem('jellyfin_token', newToken);
        localStorage.setItem('jellyfin_user', JSON.stringify(newUser));
        
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
    localStorage.removeItem('jellyfin_token');
    localStorage.removeItem('jellyfin_user');
  };

  const authContextValue: AuthContextType = {
    user,
    isAuthenticated,
    token,
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

