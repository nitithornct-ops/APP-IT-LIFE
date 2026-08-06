import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { apiFetch } from '../services/apiClient';
import { useAuth } from '../stores/authContext';

const profileFormSchema = z.object({
  fullName: z.string().trim().min(1, 'กรุณากรอกชื่อ-สกุล'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-() ]*$/, 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง')
    .optional()
    .or(z.literal('')),
});

type ProfileForm = z.infer<typeof profileFormSchema>;

export function ProfilePage() {
  const { me, isMeLoading } = useAuth();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileForm>({ resolver: zodResolver(profileFormSchema) });

  useEffect(() => {
    if (me) {
      reset({ fullName: me.profile.full_name, phone: me.profile.phone ?? '' });
    }
  }, [me, reset]);

  const mutation = useMutation({
    mutationFn: (values: ProfileForm) =>
      apiFetch('/api/v1/auth/profile', { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isMeLoading || !me) {
    return (
      <div className="flex items-center justify-center py-20" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-xl font-semibold text-slate-800 dark:text-slate-100">โปรไฟล์ของฉัน</h1>

      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="flex flex-col gap-4" noValidate>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-500 dark:text-slate-400">อีเมล</span>
          <p className="text-sm text-slate-800 dark:text-slate-200">{me.profile.email}</p>
        </div>

        <div>
          <label htmlFor="fullName" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            ชื่อ-สกุล
          </label>
          <input
            id="fullName"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            {...register('fullName')}
          />
          {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>}
        </div>

        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            เบอร์โทรศัพท์
          </label>
          <input
            id="phone"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            {...register('phone')}
          />
          {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p>}
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-500 dark:text-slate-400">บทบาท</span>
          <div className="flex flex-wrap gap-2">
            {me.roles.map((role) => (
              <span
                key={role.role_key}
                className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              >
                {role.role_name_th}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!isDirty || isSubmitting}
            className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            บันทึก
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              บันทึกแล้ว
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
