import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import api from '../utils/api';

export interface AuthUser {
  id: number;
  email: string | null;
  name: string | null;
  walletAddress: string | null;
  organizationId: number | null;
  organizationName: string | null;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function storedToken() {
  return localStorage.getItem('payd_auth_token');
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const location = useLocation();
  const [token, setToken] = useState<string | null>(() => storedToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(() => Boolean(storedToken()));

  const loadSession = useCallback(async (currentToken: string | null) => {
    if (!currentToken) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await api.get<{ user: AuthUser }>('/auth/session');
      setUser(response.data.user);
    } catch (error) {
      setUser(null);

      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 ||
          error.response?.status === 403 ||
          error.response?.status === 404)
      ) {
        localStorage.removeItem('payd_auth_token');
        localStorage.removeItem('accessToken');
        setToken(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const currentToken = storedToken();
    if (currentToken !== token) {
      setToken(currentToken);
    }
  }, [location.pathname, token]);

  useEffect(() => {
    void loadSession(token);
  }, [loadSession, token]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'payd_auth_token') {
        setToken(event.newValue);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('payd_auth_token');
    localStorage.removeItem('accessToken');
    setToken(null);
    setUser(null);
    window.location.assign('/login');
  }, []);

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
