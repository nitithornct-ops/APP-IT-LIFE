import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { PublicBrand } from '../components/PublicBrand';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabase';
import { vendorPortalApiFetch } from '../services/vendorPortalApiClient';

const passwordRule = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/;

export function VendorPortalInvitePage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<{ qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setHasSession(Boolean(data.session));
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  async function acceptInvite(event: FormEvent) {
    event.preventDefault();
    if (!passwordRule.test(password)) {
      setError('Password ต้องมีอย่างน้อย 12 ตัวอักษร และมี a-z, A-Z และตัวเลข');
      return;
    }
    if (password !== confirmPassword) {
      setError('Password และการยืนยัน Password ไม่ตรงกัน');
      return;
    }
    setSubmitting(true); setError('');
    try {
      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) throw passwordError;
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;
      const verified = factors.totp.find((factor) => factor.status === 'verified');
      let activeFactorId = factorId ?? verified?.id ?? null;
      if (!activeFactorId) {
        for (const stale of factors.totp.filter((factor) => factor.status !== 'verified')) {
          await supabase.auth.mfa.unenroll({ factorId: stale.id });
        }
        const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'LIFE Vendor Portal',
        });
        if (enrollError || !enrolled) throw enrollError ?? new Error('MFA enrollment failed');
        activeFactorId = enrolled.id;
        setFactorId(enrolled.id);
        setEnrollment({ qrCode: enrolled.totp.qr_code, secret: enrolled.totp.secret });
        setSubmitting(false);
        return;
      }
      setFactorId(activeFactorId);
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: activeFactorId, code });
      if (verifyError) throw verifyError;
      await vendorPortalApiFetch('/api/v1/vendor-portal/invite/complete', { method: 'POST', body: JSON.stringify({ mfaFactorId: activeFactorId }) });
      navigate('/vendor/portal', { replace: true });
    } catch {
      setError('ไม่สามารถตั้งค่า Password หรือ MFA ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return <main className="life-public flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></main>;
  if (!hasSession) return <Navigate to="/vendor/portal" replace />;

  return (
    <main className="life-public public-auth-page flex min-h-screen items-center justify-center p-6">
      <div className="public-auth-panel w-full max-w-md p-6">
        <PublicBrand className="mb-6" />
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><KeyRound className="h-5 w-5" /></div>
        <h1 className="font-display text-2xl font-semibold text-slate-800">ตั้งค่า Vendor Portal</h1>
        <p className="mt-1 text-sm text-slate-500">ตั้ง Password ของคุณเอง แล้วผูก MFA ก่อนเริ่มใช้งาน</p>
        <form onSubmit={acceptInvite} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">Password ใหม่<input required type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} className="public-field mt-1 w-full px-3 py-3" /></label>
          <label className="block text-sm font-medium text-slate-700">ยืนยัน Password<input required type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="public-field mt-1 w-full px-3 py-3" /></label>
          {enrollment && <div className="rounded-xl border border-slate-200 bg-white p-4 text-center"><p className="text-sm font-semibold text-slate-700">สแกน QR ด้วย Authenticator</p><img src={enrollment.qrCode} alt="QR code สำหรับตั้งค่า MFA" className="mx-auto mt-3 h-44 w-44" /><p className="mt-3 text-xs text-slate-500">หรือใช้ Secret นี้</p><code className="mt-1 block break-all rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">{enrollment.secret}</code></div>}
          {factorId && <label className="block text-sm font-medium text-slate-700">รหัส MFA 6 หลัก<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="public-field mt-1 w-full px-3 py-3 text-center font-mono text-xl tracking-[0.3em]" /></label>}
          {error && <div className="public-notice flex items-center gap-2 px-3 py-2 text-sm text-red-700" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
          <Button type="submit" className="w-full" isLoading={submitting}>{factorId ? 'ยืนยัน MFA และเปิดใช้งาน' : 'บันทึก Password และตั้งค่า MFA'}</Button>
        </form>
      </div>
    </main>
  );
}
