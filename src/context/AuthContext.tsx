import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User } from '../types/index.ts';
import { api, errorMessage, SESSION_EXPIRED_EVENT, tokenStorage } from '../api/client.ts';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authError: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  retry: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Only a 401 (handled in the API client) ends the session. Other failures keep the token and show a retry message.
  const restore = useCallback(async () => {
    if (!tokenStorage.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setAuthError(null);
    try {
      const res = await api.auth.me();
      setUser(res.user);
    } catch (err) {
      setUser(null);
      if (tokenStorage.get()) setAuthError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    restore();
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [restore]);

  const login = (token: string, newUser: User) => {
    tokenStorage.set(token);
    setAuthError(null);
    setUser(newUser);
    setLoading(false);
  };

  const logout = () => {
    tokenStorage.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, authError, login, logout, retry: restore }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
