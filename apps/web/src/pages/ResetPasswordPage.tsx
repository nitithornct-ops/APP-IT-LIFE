import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
    path: ['confirmPassword'],
  });

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

/**
 * ผู้ใช้มาถึงหน้านี้จากลิงก์ในอีเมล — Supabase JS client (detectSessionInUrl: true) จะแลก token
 * ใน URL เป็น Session ชั่วคราวให้อัตโนมัติก่อนหน้านี้จะ mount เสร็จ
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordForm>({ resolver: zodResolver(resetPasswordSchema) });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasRecoverySession(data.session !== null);
    });
  }, []);

  async function onSubmit(values: ResetPasswordForm) {
    setSubmitError(null);
    const { error } = await supabase.auth.updateUser({ password: values.password });

    if (error) {
      setSubmitError('ตั้งรหัสผ่านใหม่ไม่สำเร็จ ลิงก์อาจหมดอายุแล้ว กรุณาขอลิงก์ใหม่');
      return;
    }

    setSuccess(true);
    setTimeout(() => navigate('/', { replace: true }), 1500);
  }

  if (hasRecoverySession === false) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg bg-white p-6 text-center shadow-sm dark:bg-slate-800">
          <AlertTriangle className="h-8 w-8 text-red-600" aria-hidden="true" />
          <p className="text-sm text-slate-700 dark:text-slate-200">
            ลิงก์นี้ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ตั้งรหัสผ่านใหม่อีกครั้ง
          </p>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg bg-white p-6 text-center shadow-sm dark:bg-slate-800">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
          <p className="text-sm text-slate-700 dark:text-slate-200">ตั้งรหัสผ่านใหม่สำเร็จ กำลังพาไปหน้าหลัก...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-sm dark:bg-slate-800">
        <h1 className="mb-6 text-center text-lg font-semibold text-slate-800 dark:text-slate-100">ตั้งรหัสผ่านใหม่</h1>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              รหัสผ่านใหม่
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              {...register('password')}
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              ยืนยันรหัสผ่านใหม่
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>}
          </div>

          {submitError && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || hasRecoverySession === null}
            className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            บันทึกรหัสผ่านใหม่
          </button>
        </form>
      </div>
    </main>
  );
}
