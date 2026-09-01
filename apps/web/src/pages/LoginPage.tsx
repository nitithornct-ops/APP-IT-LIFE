import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { PublicBrand } from '../components/PublicBrand';
import { TurnstileWidget, type TurnstileWidgetHandle } from '../components/TurnstileWidget';
import { supabase } from '../lib/supabase';
import { apiFetch, showToast } from '../services/apiClient';
import type { MfaPolicyResponse } from '../stores/authContext';

const loginSchema = z.object({
  email: z.string().trim().email('กรุณากรอกอีเมลให้ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});

type LoginForm = z.infer<typeof loginSchema>;

/**
 * บันทึก Login Log เป็นงานเบื้องหลัง ไม่ใช่การกระทำที่ผู้ใช้กดเอง จึงต้องส่ง silent
 * มิฉะนั้น POST นี้จะไปกระตุ้นข้อความเขียว "บันทึกข้อมูลเรียบร้อยแล้ว" ของ apiFetch
 * ซึ่งจะขึ้นแม้ตอน login ไม่ผ่าน ขัดกับข้อความแดงที่แสดงอยู่พร้อมกัน
 */
async function recordLoginAttempt(email: string, success: boolean, failureReason?: string) {
  try {
    await apiFetch(
      '/api/v1/auth/login-log',
      { method: 'POST', body: JSON.stringify({ email, success, failureReason }) },
      { silent: true },
    );
  } catch {
    // การบันทึก Login Log ล้มเหลวต้องไม่ขวางผู้ใช้ที่ login สำเร็จอยู่แล้ว
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState('');
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginForm) {
    setErrorMessage(null);
    if (!captchaToken) {
      setErrorMessage('กรุณายืนยันความปลอดภัยก่อนเข้าสู่ระบบ');
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        ...values,
        options: { captchaToken },
      });

      if (error) {
        await recordLoginAttempt(values.email, false, error.message);
        setErrorMessage('อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
        return;
      }

      const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
      const policy = await apiFetch<MfaPolicyResponse>('/api/v1/auth/mfa-policy', undefined, { silent: true });
      if (policy.required && policy.currentLevel !== 'aal2') {
        navigate('/mfa', { replace: true, state: { from: redirectTo } });
        return;
      }

      await recordLoginAttempt(values.email, true);
      showToast('success', 'เข้าสู่ระบบสำเร็จ');
      navigate(redirectTo, { replace: true });
    } catch {
      setErrorMessage('ตรวจสอบนโยบายความปลอดภัยไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      turnstileRef.current?.reset();
    }
  }

  return (
    <main className="life-public public-auth-page flex min-h-screen items-center justify-center p-6">
      <div className="public-auth-panel w-full max-w-sm p-6">
        <PublicBrand className="mb-6" />
        <h1 className="mb-1 font-display text-2xl font-semibold text-slate-800 dark:text-slate-100">เข้าสู่ระบบ</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">สำหรับเจ้าหน้าที่ LIFE IT Smart Service Center</p>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              อีเมล
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="public-field w-full px-3 py-2 text-sm"
              {...register('email')}
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              รหัสผ่าน
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="public-field w-full px-3 py-2 text-sm"
              {...register('password')}
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          {errorMessage && (
            <div className="public-notice flex items-center gap-2 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          <TurnstileWidget ref={turnstileRef} action="login" onTokenChange={setCaptchaToken} />

          <button
            type="submit"
            disabled={isSubmitting || !captchaToken}
            className="public-primary-button flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            เข้าสู่ระบบ
          </button>

          <Link to="/forgot-password" className="public-link text-center text-sm">
            ลืมรหัสผ่าน?
          </Link>
        </form>

        <div className="mt-4 border-t border-slate-200 pt-4 text-center dark:border-slate-700">
          <Link to="/report" className="public-link text-sm">
            แจ้งปัญหา IT โดยไม่ต้องเข้าสู่ระบบ →
          </Link>
        </div>
      </div>
    </main>
  );
}
