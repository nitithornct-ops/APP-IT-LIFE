import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { ApiError, apiFetch } from '../services/apiClient';

export interface MeProfile {
  id: string;
  employee_code: string | null;
  full_name: string;
  email: string;
  /** มีค่าเฉพาะบัญชีที่ login ด้วยชื่อผู้ใช้ (ไม่มีอีเมลจริง) — บัญชีที่เชิญด้วยอีเมลเป็น null */
  username: string | null;
  phone: string | null;
  department_id: string | null;
  position_id: string | null;
  supervisor_id: string | null;
  status: 'active' | 'inactive';
  mfa_enabled?: boolean;
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

export interface MfaPolicyResponse {
  required: boolean;
  reason: 'enrolled_factor' | 'user_enabled' | 'admin_role' | 'approver_role' | 'approval_permission' | 'export_permission' | null;
  enrolled: boolean;
  currentLevel: string | null;
  needsEnrollment: boolean;
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

/**
 * เครือข่ายสะดุดไม่ใช่คำตอบจากเซิร์ฟเวอร์ — แยกออกจาก error ที่เซิร์ฟเวอร์ตอบกลับมาจริง
 * เพื่อให้ฝั่งเรียกตัดสินใจได้ว่าควรเชื่อผลลัพธ์นี้หรือควรคงคำตอบเดิมไว้
 */
function isTransportFailure(error: unknown): boolean {
  return error instanceof ApiError && ['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_CANCELLED'].includes(error.code);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isMfaLoading, setIsMfaLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(false);
  const queryClient = useQueryClient();

  /** ผู้ใช้ที่ตรวจนโยบาย MFA ไปแล้ว — `undefined` คือยังไม่เคยตรวจ ต่างจาก `null` ที่แปลว่าตรวจแล้วและไม่มีใคร login */
  const evaluatedUserIdRef = useRef<string | null | undefined>(undefined);
  /** ลำดับคำขอล่าสุด กันคำตอบของรอบเก่าที่มาช้ากว่ามาทับผลของรอบใหม่ */
  const mfaRequestSeqRef = useRef(0);
  /** เคยได้คำตอบจากเซิร์ฟเวอร์สำเร็จอย่างน้อยหนึ่งครั้งสำหรับผู้ใช้คนปัจจุบันหรือยัง */
  const hasMfaAnswerRef = useRef(false);

  async function evaluateMfa(nextSession: Session | null) {
    const seq = (mfaRequestSeqRef.current += 1);
    if (!nextSession) {
      setMfaRequired(false);
      setIsMfaLoading(false);
      return;
    }
    setIsMfaLoading(true);
    try {
      const policy = await apiFetch<MfaPolicyResponse>('/api/v1/auth/mfa-policy', undefined, { silent: true });
      if (seq !== mfaRequestSeqRef.current) return;
      hasMfaAnswerRef.current = true;
      setMfaRequired(policy.required && policy.currentLevel !== 'aal2');
    } catch (error) {
      if (seq !== mfaRequestSeqRef.current) return;
      // The server is authoritative for privileged roles. A lookup outage must not silently
      // downgrade an admin/approver/exporter to AAL1 — a failure before any answer fails closed.
      //
      // แต่ถ้าเคยได้คำตอบมาแล้วและรอบนี้ล้มเพราะเครือข่ายล้วน ๆ (มือถือเพิ่งตื่นจากพักหน้าจอ สัญญาณยังไม่กลับมา)
      // การตั้ง mfaRequired = true จะเด้งผู้ใช้ที่กำลังทำงานอยู่ไปหน้า /mfa ทั้งที่สิทธิ์ไม่ได้เปลี่ยนอะไรเลย
      // จึงคงคำตอบเดิมไว้ — Backend ตรวจระดับ AAL ซ้ำทุก request อยู่แล้ว การคงค่าไว้จึงไม่เปิดช่องให้ใคร
      if (!hasMfaAnswerRef.current || !isTransportFailure(error)) {
        setMfaRequired(true);
      }
    } finally {
      if (seq === mfaRequestSeqRef.current) setIsMfaLoading(false);
    }
  }

  /**
   * ปรับสถานะให้ตรงกับ session ที่ได้รับมา
   *
   * auth-js ผูก `visibilitychange` ไว้เอง และยิง `SIGNED_IN` ซ้ำ "ทุกครั้ง" ที่แท็บกลับมามองเห็น
   * แม้ session จะไม่ได้เปลี่ยนอะไรเลย (GoTrueClient._recoverAndRefresh) เดิมโค้ดนี้ตอบทุก event
   * ด้วยการตั้ง isMfaLoading = true ซึ่งทำให้ <ProtectedRoute> คืนสปินเนอร์เต็มจอแทน <AppShell />
   * ทั้งแอปจึงถูก unmount ทิ้งแล้วสร้างใหม่ทุกครั้งที่สลับแอป/สลับแท็บกลับมา — ฟอร์มที่พิมพ์ค้างไว้
   * ตัวกรอง เลขหน้า โมดัลที่เปิดอยู่ และตำแหน่ง scroll หายหมด เหมือนโดนรีเฟรช
   * (ผู้ใช้แจ้ง 2026-09-09 ว่า "สลับหน้าแล้วต้องรีเฟรชตลอด และเป็นทุกคนที่เปิดอยู่")
   *
   * จึงตรวจนโยบาย MFA เฉพาะตอนที่ "ตัวผู้ใช้" เปลี่ยนจริง (login / logout / สลับบัญชี) เท่านั้น
   * ส่วนการต่ออายุโทเคนและ SIGNED_IN ซ้ำจาก visibility ต้องไม่แตะสถานะโหลดใด ๆ
   */
  function applySession(nextSession: Session | null) {
    // คง object เดิมไว้เมื่อ access token ไม่เปลี่ยน — auth-js parse session ใหม่จาก storage ทุกครั้ง
    // ได้ object คนละใบแต่เนื้อในเหมือนเดิม ปล่อยผ่านจะ re-render ทั้งแอปฟรี ๆ ทุกครั้งที่กลับมาที่แท็บ
    setSession((prev) => (prev?.access_token === nextSession?.access_token ? prev : nextSession));

    const nextUserId = nextSession?.user.id ?? null;
    if (nextUserId === evaluatedUserIdRef.current) return;
    evaluatedUserIdRef.current = nextUserId;
    hasMfaAnswerRef.current = false;
    void evaluateMfa(nextSession);
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
      setIsSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      applySession(newSession);
    });

    return () => subscription.unsubscribe();
    // applySession อ่านค่าผ่าน ref และเรียกแต่ setState ที่ identity คงที่ จึงไม่ต้องผูกเป็น dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
