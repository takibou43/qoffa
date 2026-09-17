import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, clearToken, getToken, setToken } from './api';
import type { User } from './types';

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (input: {
    fullName: string;
    phone: string;
    password: string;
    email?: string;
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const result = await api.login(phone, password);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const register = useCallback(
    async (input: { fullName: string; phone: string; password: string; email?: string }) => {
      const result = await api.registerCustomer(input);
      setToken(result.token);
      setUser(result.user);
    },
    [],
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth يجب أن يُستعمل داخل AuthProvider');
  return context;
}
