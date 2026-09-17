import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, clearToken, getToken, setToken } from './api';
import type { User } from './types';

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  refresh: () => Promise<void>;
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
    // الصلاحية تُفرض في الخادم؛ هذا الفحص فقط لتوجيه المستخدم للتطبيق الصحيح
    if (result.user.role !== 'ADMIN' && result.user.role !== 'SUPER_ADMIN') {
      throw new Error('هذه اللوحة مخصصة لإدارة المنصة فقط.');
    }
    setToken(result.token);
    setUser(result.user);
  }, []);

  const refresh = useCallback(async () => {
    const r = await api.me();
    setUser(r.user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, refresh, logout }),
    [user, loading, login, refresh, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth يجب أن يُستعمل داخل AuthProvider');
  return context;
}
