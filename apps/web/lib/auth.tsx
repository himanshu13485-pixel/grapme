'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { api, setToken, setRefreshToken, clearTokens } from './api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'SUB_ADMIN' | 'USER' | 'CLIENT';
  tenantId: string;
  fullAccess?: boolean;
  accessModules?: string[];
  canDelete?: boolean;
  profileLimit?: number;
}

interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
    tenantName?: string,
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // After auth, pull the full profile (/auth/me) so the session user carries
  // fullAccess + accessModules — the login response omits them.
  async function hydrateUser(fallback: AuthUser) {
    try {
      setUser(await api.get<AuthUser>('/auth/me'));
    } catch {
      setUser(fallback);
    }
  }

  async function login(email: string, password: string) {
    const res = await api.post<LoginResponse>('/auth/login', {
      email,
      password,
    });
    setToken(res.accessToken);
    setRefreshToken(res.refreshToken);
    await hydrateUser(res.user);
  }

  async function register(
    name: string,
    email: string,
    password: string,
    tenantName?: string,
  ) {
    const res = await api.post<LoginResponse>('/auth/register', {
      name,
      email,
      password,
      tenantName,
    });
    setToken(res.accessToken);
    setRefreshToken(res.refreshToken);
    await hydrateUser(res.user);
  }

  function logout() {
    clearTokens();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Whether the signed-in user may use delete actions. Super admins always can;
 *  sub-admins only if granted (full access or the canDelete flag). */
export function useCanDelete(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (user.role === 'SUB_ADMIN') return !!(user.fullAccess || user.canDelete);
  if (user.role === 'CLIENT') return false; // deletes go through admin
  return true;
}
