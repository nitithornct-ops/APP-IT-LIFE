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
  /** null ทั้งคู่ = ยังไม่เคยปิดคำแนะนำเริ่มต้น (migration 20260918100000) */
  onboarding_completed_at?: string | null;
  onboarding_dismissed_at?: string | null;
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
  isMfaLoading: boolean;
  mfaRequired: boolean;
  me: MeResponse | undefined;
  isMeLoading: boolean;
  meError: Error | null;
  refetchMe: () => void;
  hasPermission: (key: string) => boolean;
  hasRole: (key: string) => boolean;
  signOut: () => Promise<void>;
  refreshMfa: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isMfaLoading, setIsMfaLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(false);
  const queryClient = useQueryClient();

  async function evaluateMfa(nextSession: Session | null) {
    if (!nextSession) {
      setMfaRequired(false);
      setIsMfaLoading(false);
      return;
    }
    setIsMfaLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const hasVerifiedFactor = nextSession.user.factors?.some((factor) => factor.status === 'verified') ?? false;
      setMfaRequired(error ? hasVerifiedFactor : data.nextLevel === 'aal2' && data.currentLevel !== 'aal2');
    } catch {
      // Fail closed for accounts known to have MFA if the assurance-level check is unavailable.
      setMfaRequired(nextSession.user.factors?.some((factor) => factor.status === 'verified') ?? false);
    } finally {
      setIsMfaLoading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsSessionLoading(false);
      void evaluateMfa(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      void evaluateMfa(newSession);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<MeResponse>('/api/v1/auth/me'),
    enabled: session !== null && !mfaRequired && !isMfaLoading,
    staleTime: 60_000,
  });

  async function signOut() {
    await supabase.auth.signOut();
    queryClient.clear();
  }

  const value: AuthContextValue = {
    session,
    isSessionLoading,
    isMfaLoading,
    mfaRequired,
    me: meQuery.data,
    isMeLoading: meQuery.isLoading,
    meError: meQuery.error,
    refetchMe: () => {
      void meQuery.refetch();
    },
    hasPermission: (key) => meQuery.data?.permissions.includes(key) ?? false,
    hasRole: (key) => meQuery.data?.roles.some((r) => r.role_key === key) ?? false,
    signOut,
    refreshMfa: () => evaluateMfa(session),
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
