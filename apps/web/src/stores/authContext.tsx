import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../services/apiClient';

export interface MeProfile {
  id: string;
  employee_code: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  department_id: string | null;
  position_id: string | null;
  supervisor_id: string | null;
  status: 'active' | 'inactive';
}

export interface MeRole {
  role_key: string;
  role_name_th: string;
  role_name_en: string | null;
}

export interface MeResponse {
  profile: MeProfile;
  roles: MeRole[];
  permissions: string[];
}

interface AuthContextValue {
  session: Session | null;
  isSessionLoading: boolean;
  me: MeResponse | undefined;
  isMeLoading: boolean;
  meError: Error | null;
  refetchMe: () => void;
  hasPermission: (key: string) => boolean;
  hasRole: (key: string) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<MeResponse>('/api/v1/auth/me'),
    enabled: session !== null,
    staleTime: 60_000,
  });

  async function signOut() {
    await supabase.auth.signOut();
    queryClient.clear();
  }

  const value: AuthContextValue = {
    session,
    isSessionLoading,
    me: meQuery.data,
    isMeLoading: meQuery.isLoading,
    meError: meQuery.error,
    refetchMe: () => {
      void meQuery.refetch();
    },
    hasPermission: (key) => meQuery.data?.permissions.includes(key) ?? false,
    hasRole: (key) => meQuery.data?.roles.some((r) => r.role_key === key) ?? false,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The provider and its context hook intentionally share this module as one public API.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth ต้องถูกเรียกภายใน <AuthProvider>');
  }
  return ctx;
}
