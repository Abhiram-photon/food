import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setCsrfToken } from '../api/client';
import type { AuthResponse, PublicUser, RegisterInput } from '@shared';

export interface Capabilities {
  canPublishListing: boolean;
  canReserve: boolean;
  canVerifyPickup: boolean;
  canModerateOrganizations: boolean;
  blockedReason: string | null;
}

interface AuthState {
  user: PublicUser | null;
  capabilities: Capabilities | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<PublicUser>;
  register: (input: RegisterInput) => Promise<PublicUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyAuth = useCallback((response: AuthResponse | { user: null }) => {
    if (!response.user) {
      setUser(null);
      setCapabilities(null);
      setCsrfToken(null);
      return;
    }
    setUser(response.user);
    setCapabilities((response as AuthResponse).capabilities);
    setCsrfToken((response as AuthResponse).csrfToken);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<AuthResponse | { user: null }>('/auth/me');
      applyAuth(response);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your session.');
    } finally {
      setLoading(false);
    }
  }, [applyAuth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api.post<AuthResponse>('/auth/login', { email, password });
      applyAuth(response);
      return response.user;
    },
    [applyAuth],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const response = await api.post<AuthResponse>('/auth/register', input);
      applyAuth(response);
      return response.user;
    },
    [applyAuth],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
    setCapabilities(null);
    setCsrfToken(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, capabilities, loading, error, login, register, logout, refresh }),
    [user, capabilities, loading, error, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
