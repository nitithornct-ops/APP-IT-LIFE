import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../services/apiClient';

const loginSchema = z.object({
  email: z.string().trim().email('กรุณากรอกอีเมลให้ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});

type LoginForm = z.infer<typeof loginSchema>;

async function recordLoginAttempt(email: string, success: boolean, failureReason?: string) {
  try {
    await apiFetch('/api/v1/auth/login-log', {
      method: 'POST',
      body: JSON.stringify({ email, success, failureReason }),
    });
  } catch {
    // การบันทึก Login Log ล้มเหลวต้องไม่ขวางผู้ใช้ที่ login สำเร็จอยู่แล้ว
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginForm) {
    setErrorMessage(null);
    const { error } = await supabase.auth.signInWithPassword(values);

    if (error) {
      await recordLoginAttempt(values.email, false, error.message);
      setErrorMessage('อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
      return;
    }

    await recordLoginAttempt(values.email, true);
    const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
    navigate(redirectTo, { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-sm dark:bg-slate-800">
        <h1 className="mb-1 text-center text-lg font-semibold text-slate-800 dark:text-slate-100">
          LIFE IT Smart Service Center
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">เข้าสู่ระบบสำหรับเจ้าหน้าที่</p>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              อีเมล
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              {...register('password')}
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            เข้าสู่ระบบ
          </button>

          <Link to="/forgot-password" className="text-center text-sm text-blue-600 hover:underline dark:text-blue-400">
            ลืมรหัสผ่าน?
          </Link>
        </form>

        <div className="mt-4 border-t border-slate-200 pt-4 text-center dark:border-slate-700">
          <Link to="/report" className="text-sm text-slate-500 hover:text-blue-600 hover:underline dark:text-slate-400">
            แจ้งปัญหา IT โดยไม่ต้องเข้าสู่ระบบ →
          </Link>
        </div>
      </div>
    </main>
  );
}
