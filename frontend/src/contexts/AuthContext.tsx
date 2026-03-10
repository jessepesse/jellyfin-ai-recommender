import { createContext, useState, use, useEffect } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';
import { getMe } from '../services/api';

// Define the shape of the Jellyfin user returned by our backend
interface User {
  id: string;
  name: string;
  isAdmin?: boolean;
}

// Define the shape of the authentication state and actions
interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  token: string | null;
  serverUrl: string | null;
  login: (username: string, password: string, serverUrl?: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

// Create the Auth Context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Define the AuthProvider component
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // Initialize state from local storage to avoid useEffect re-renders
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('jellyfin_user');
    const storedIsAdmin = localStorage.getItem('jellyfin_isAdmin');
    try {
      const parsedUser = stored ? JSON.parse(stored) : null;
      if (parsedUser && storedIsAdmin) {
        parsedUser.isAdmin = storedIsAdmin === 'true';
      }
      return parsedUser;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState<string | null>(() => localStorage.getItem('jellyfin_token'));

  const [serverUrl, setServerUrl] = useState<string | null>(() => localStorage.getItem('jellyfin_server'));

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return !!(localStorage.getItem('jellyfin_token') && localStorage.getItem('jellyfin_user'));
  });

  // On mount and whenever authentication state changes, refresh admin status from the
  // server so that UI gating is based on a verified token, not a mutable localStorage value.
  useEffect(() => {
    if (!isAuthenticated) return;
    getMe()
      .then(me => {
        setUser(prev => prev ? { ...prev, isAdmin: me.isAdmin } : prev);
      })
      .catch(() => {
        // Network failure or invalid token — leave the localStorage-seeded value in place;
        // the backend will still reject any admin-level API calls.
      });
  }, [isAuthenticated]);

  const logout = async () => {
    try {
      const storedToken = localStorage.getItem('jellyfin_token');
      if (storedToken) {
        const baseUrl = import.meta.env.VITE_BACKEND_URL
          ? import.meta.env.VITE_BACKEND_URL + '/api'
          : '/api';
        await axios.post(`${baseUrl}/auth/logout`, {}, {
          headers: { 'x-access-token': storedToken },
        });
      }
    } catch {
      // Best-effort — local cleanup proceeds regardless
    }
    setUser(null);
    setToken(null);
    setIsAuthenticated(false);
    setServerUrl(null);
    localStorage.removeItem('jellyfin_token');
    localStorage.removeItem('jellyfin_user');
    localStorage.removeItem('jellyfin_server');
    localStorage.removeItem('jellyfin_isAdmin');
    sessionStorage.removeItem('jellyfin_password');
  };

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

      if (response.data.success && response.data.sessionToken) {
        const { sessionToken, user: responseUser, isAdmin: respIsAdmin, serverUrl: respServerUrl } = response.data;
        const isAdmin = respIsAdmin ?? false;
        const newUser: User = {
          id: responseUser.id,
          name: responseUser.name,
          isAdmin,
        };
        const newServer = respServerUrl || serverUrl || import.meta.env.VITE_JELLYFIN_URL || null;

        setUser(newUser);
        setToken(sessionToken);
        setIsAuthenticated(true);
        setServerUrl(newServer);

        localStorage.setItem('jellyfin_token', sessionToken);
        localStorage.setItem('jellyfin_user', JSON.stringify(newUser));
        localStorage.setItem('jellyfin_isAdmin', String(isAdmin));
        if (newServer) {
          localStorage.setItem('jellyfin_server', newServer);
        }
        // Remove legacy password storage if present from a previous session
        sessionStorage.removeItem('jellyfin_password');

        return true;
      } else {
        throw new Error(response.data.message || 'Login failed. Please check your credentials.');
      }
    } catch (error: unknown) {
      if (error instanceof Error && !('response' in error)) {
        throw error; // re-throw our own errors (already have clean messages)
      }
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      const message = err.response?.data?.message || err.message || 'Login failed. Please check your credentials.';
      throw new Error(message, { cause: error });
    }
  };

  const authContextValue: AuthContextType = {
    user,
    isAuthenticated,
    token,
    serverUrl,
    login,
    logout,
  };

  return <AuthContext value={authContextValue}>{children}</AuthContext>;
};

// Custom hook to use the Auth Context
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = use(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

