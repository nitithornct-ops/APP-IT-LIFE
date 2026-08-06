import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

const forgotPasswordSchema = z.object({
  email: z.string().trim().email('กรุณากรอกอีเมลให้ถูกต้อง'),
});

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordForm>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values: ForgotPasswordForm) {
    await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // แสดงข้อความเดียวกันเสมอไม่ว่าจะพบอีเมลนี้ในระบบหรือไม่ เพื่อป้องกัน Email/User Enumeration
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg bg-white p-6 text-center shadow-sm dark:bg-slate-800">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
          <p className="text-sm text-slate-700 dark:text-slate-200">
            หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว กรุณาตรวจสอบกล่องจดหมาย
          </p>
          <Link to="/login" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-sm dark:bg-slate-800">
        <h1 className="mb-1 text-center text-lg font-semibold text-slate-800 dark:text-slate-100">ลืมรหัสผ่าน</h1>
        <p className="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">
          กรอกอีเมลที่ใช้เข้าสู่ระบบ เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้ทางอีเมล
        </p>

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

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            ส่งลิงก์ตั้งรหัสผ่านใหม่
          </button>

          <Link to="/login" className="text-center text-sm text-blue-600 hover:underline dark:text-blue-400">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </form>
      </div>
    </main>
  );
}
