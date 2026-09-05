import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Mail, Phone, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { LineNotificationCard } from '../features/profile/LineNotificationCard';
import { TechnicianSkillPanel } from '../features/technicianSkills/TechnicianSkillPanel';
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
  const { me, isMeLoading, meError, refetchMe, hasPermission } = useAuth();
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

  if (isMeLoading) {
    return (
      <div className="flex items-center justify-center py-20" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        <span className="sr-only">กำลังโหลดข้อมูลโปรไฟล์</span>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center rounded-xl border border-amber-200 bg-amber-50 px-6 py-10 text-center dark:border-amber-900/60 dark:bg-amber-950/30" role="alert">
        <AlertCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-slate-800 dark:text-slate-100">โหลดข้อมูลโปรไฟล์ไม่สำเร็จ</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {meError ? 'ไม่สามารถเชื่อมต่อบริการข้อมูลผู้ใช้ได้ กรุณาตรวจสอบว่า API ทำงานอยู่แล้วลองใหม่' : 'ไม่พบข้อมูลผู้ใช้สำหรับบัญชีนี้'}
        </p>
        <button
          type="button"
          onClick={refetchMe}
          className="mt-5 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          ลองใหม่
        </button>
      </div>
    );
  }

  const initials = me.profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('') || 'IT';
  const permissionModules = new Set(me.permissions.map((permission) => permission.split('.')[0])).size;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div><h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">โปรไฟล์ช่างและสิทธิ์ใช้งาน</h1><p className="mt-1 text-sm text-slate-500">ข้อมูลติดต่อ บทบาท และขอบเขตงานของบัญชีปัจจุบัน</p></div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-[10px] bg-[#0B1B36] p-5 text-white shadow-card">
            <div className="flex items-center gap-3"><span className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-primary-600 text-lg font-extrabold">{initials}</span><div className="min-w-0"><p className="truncate text-base font-bold">{me.profile.full_name}</p><p className="mt-0.5 truncate font-mono text-[10px] text-white/50">{me.profile.employee_code ?? me.profile.email}</p></div></div>
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs"><span className={`h-2 w-2 rounded-full ${me.profile.status === 'active' ? 'bg-green-400' : 'bg-slate-400'}`} /><span>{me.profile.status === 'active' ? 'บัญชีพร้อมใช้งาน' : 'บัญชีถูกระงับ'}</span></div>
            <div className="mt-5 grid grid-cols-3 gap-3"><div><p className="text-[10px] text-white/45">บทบาท</p><p className="mt-1 font-mono text-xl font-bold">{me.roles.length}</p></div><div><p className="text-[10px] text-white/45">สิทธิ์</p><p className="mt-1 font-mono text-xl font-bold">{me.permissions.length}</p></div><div><p className="text-[10px] text-white/45">โมดูล</p><p className="mt-1 font-mono text-xl font-bold">{permissionModules}</p></div></div>
          </div>

          <Card>
            <CardHeader className="flex items-center gap-2"><UserRound className="h-4 w-4 text-primary-600" />ข้อมูลติดต่อ</CardHeader>
            <CardBody className="space-y-3 text-sm"><p className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Mail className="h-4 w-4 text-slate-400" /><span className="min-w-0 truncate">{me.profile.email}</span></p><p className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Phone className="h-4 w-4 text-slate-400" />{me.profile.phone || 'ยังไม่ระบุเบอร์โทรศัพท์'}</p></CardBody>
          </Card>

          {hasPermission('technician_skill.view') && (
            <div className="rounded-[10px] border border-hairline bg-slate-50 p-4 dark:border-white/[.08] dark:bg-white/[.03]"><p className="text-xs font-bold text-ink-heading dark:text-slate-100">ตารางทักษะทั้งทีม</p><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">เทียบระดับทักษะของเจ้าหน้าที่ทุกคน และตรวจว่าหมวดหมู่งานใดยังไม่มีผู้รับงาน</p><Link to="/admin/technician-skills" className="mt-3 inline-block text-xs font-bold text-primary-700 hover:underline dark:text-primary-300">เปิดตารางทักษะช่าง</Link></div>
          )}
        </aside>

        <div className="space-y-4">
        <Card>
          <CardHeader>แก้ไขข้อมูลส่วนตัว</CardHeader>
          <CardBody>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-500 dark:text-slate-400">อีเมล</span>
          <p className="text-sm text-slate-800 dark:text-slate-200">{me.profile.email}</p>
        </div>

        <div>
          <label htmlFor="fullName" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            ชื่อ-สกุล
          </label>
          <input
            id="fullName"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
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
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            {...register('phone')}
          />
          {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p>}
        </div>

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={!isDirty || isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            บันทึก
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              บันทึกแล้ว
            </span>
          )}
        </div>
      </form>
          </CardBody>
        </Card>

        <LineNotificationCard />

        <TechnicianSkillPanel />

        <Card>
          <CardHeader className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary-600" />บทบาทและขอบเขตสิทธิ์</CardHeader>
          <CardBody><div className="flex flex-wrap gap-2">{me.roles.map((role) => <Badge key={role.role_key} variant="info">{role.role_name_th}</Badge>)}{me.roles.length === 0 && <span className="text-sm text-slate-500">ยังไม่ได้กำหนดบทบาท</span>}</div><div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-900"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" /><span>บัญชีนี้เข้าถึง {permissionModules} โมดูล จากสิทธิ์ที่มีผลจริง {me.permissions.length} รายการ หากต้องการเปลี่ยนสิทธิ์ให้ติดต่อผู้ดูแลระบบ</span></div></CardBody>
        </Card>
        </div>
      </div>
    </div>
  );
}
