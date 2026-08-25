import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PublicBrand } from '../components/PublicBrand';
import { supabase } from '../lib/supabase';
import { apiFetch, showToast } from '../services/apiClient';
import { useAuth } from '../stores/authContext';

export function MfaChallengePage() {
  const { session, isSessionLoading, mfaRequired, refreshMfa, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  useEffect(() => {
    if (!session) return;
    void supabase.auth.mfa.listFactors().then(({ data, error: factorsError }) => {
      setFactorId(data?.totp[0]?.id ?? null);
      if (factorsError || !data?.totp[0]) setError('ไม่พบอุปกรณ์ MFA แบบ TOTP ที่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
      setLoading(false);
    });
  }, [session]);

  if (!isSessionLoading && !session) return <Navigate to="/login" replace />;
  if (!isSessionLoading && session && !mfaRequired && !loading) return <Navigate to={redirectTo} replace />;

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError('กรุณากรอกรหัส 6 หลักจากแอป Authenticator');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (verifyError) {
      setError('รหัส MFA ไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่');
      setCode('');
      setSubmitting(false);
      return;
    }
    await refreshMfa();
    try {
      await apiFetch('/api/v1/auth/login-log', {
        method: 'POST',
        body: JSON.stringify({ email: session?.user.email ?? '', success: true }),
      }, { silent: true });
    } catch {
      // An audit-log outage must not strand a user after successful MFA verification.
    }
    showToast('success', 'ยืนยัน MFA สำเร็จ');
    navigate(redirectTo, { replace: true });
  }

  return (
    <main className="life-public public-auth-page flex min-h-screen items-center justify-center p-6">
      <div className="public-auth-panel w-full max-w-sm p-6">
        <PublicBrand className="mb-6" />
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-slate-800">ยืนยันตัวตนสองขั้นตอน</h1>
        <p className="mt-1 text-sm text-slate-500">กรอกรหัส 6 หลักจากแอป Authenticator เพื่อเข้าสู่ระบบต่อ</p>

        <form onSubmit={verify} className="mt-6 space-y-4">
          <label htmlFor="mfa-code" className="block text-sm font-medium text-slate-700">รหัส MFA</label>
          <input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="public-field w-full px-3 py-3 text-center font-mono text-2xl tracking-[0.35em]"
            autoFocus
            disabled={loading || submitting || !factorId}
          />
          {error && <div className="public-notice flex items-center gap-2 px-3 py-2 text-sm text-red-700" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
          <button type="submit" disabled={loading || submitting || !factorId} className="public-primary-button flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">
            {(loading || submitting) && <Loader2 className="h-4 w-4 animate-spin" />}
            ยืนยันและเข้าสู่ระบบ
          </button>
          <button type="button" onClick={() => void signOut()} className="public-link w-full text-center text-sm">ยกเลิกและออกจากระบบ</button>
        </form>
      </div>
    </main>
  );
}
