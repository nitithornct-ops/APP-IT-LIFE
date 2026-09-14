import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Monitor,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmModal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { LineNotificationCard } from '../features/profile/LineNotificationCard';
import { TechnicianSkillPanel } from '../features/technicianSkills/TechnicianSkillPanel';
import { supabase } from '../lib/supabase';
import { ApiError, apiFetch } from '../services/apiClient';
import { useAuth, type MeResponse } from '../stores/authContext';
import { formatThaiDateTime } from '../utils/date';

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
type PreferredLanguage = 'th' | 'en';

const PROFILE_TIMEZONES = [
  ['Asia/Bangkok', 'กรุงเทพฯ (UTC+07:00)'],
  ['Asia/Tokyo', 'โตเกียว (UTC+09:00)'],
  ['Asia/Singapore', 'สิงคโปร์ (UTC+08:00)'],
  ['UTC', 'UTC'],
  ['Europe/London', 'ลอนดอน'],
  ['America/New_York', 'นิวยอร์ก'],
] as const;

interface SecurityActivity {
  id: string;
  source: 'login' | 'audit';
  action: string;
  result: 'success' | 'fail' | 'denied';
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface PreferenceDraft {
  timezone: string;
  preferredLanguage: PreferredLanguage;
  inAppNotifications: boolean;
}

interface MfaFactors {
  totp: Array<{ id: string; status: string }>;
}

function browserName(): string {
  if (typeof navigator === 'undefined') return 'เบราว์เซอร์ปัจจุบัน';
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/Chrome\//.test(ua)) return 'Google Chrome';
  if (/Firefox\//.test(ua)) return 'Mozilla Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'เบราว์เซอร์ปัจจุบัน';
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    UPDATE: 'แก้ไขข้อมูล',
    UPDATE_PREFERENCES: 'เปลี่ยนการตั้งค่าโปรไฟล์',
    CHANGE_PASSWORD: 'เปลี่ยนรหัสผ่าน',
    RESET_PASSWORD: 'ผู้ดูแลตั้งรหัสผ่านใหม่',
    UPDATE_MFA: 'เปลี่ยนการตั้งค่า MFA',
  };
  return labels[action] ?? action;
}

function SecurityActivityCard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['security-activity'],
    queryFn: () => apiFetch<SecurityActivity[]>('/api/v1/auth/security-activity', undefined, { silent: true }),
  });

  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary-600" aria-hidden="true" />Security activity ล่าสุด</CardHeader>
      <CardBody>
        {isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />กำลังโหลดประวัติความปลอดภัย</p>}
        {isError && <div className="flex items-center justify-between gap-3 text-sm text-red-600"><span>ไม่สามารถโหลดประวัติความปลอดภัยได้</span><button type="button" onClick={() => void refetch()} className="font-semibold underline">ลองใหม่</button></div>}
        {!isLoading && !isError && data?.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีรายการกิจกรรม</p>}
        {!isLoading && !isError && data && data.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.map((item) => {
              const isSuccess = item.result === 'success';
              const label = item.source === 'login' ? item.action : auditActionLabel(item.action);
              return (
                <div key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isSuccess ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40' : 'bg-red-50 text-red-600 dark:bg-red-950/40'}`}>
                    {item.source === 'login' ? <LogIn className="h-4 w-4" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800 dark:text-slate-100">{label}</p><Badge variant={isSuccess ? 'success' : 'danger'}>{isSuccess ? 'สำเร็จ' : item.result === 'denied' ? 'ปฏิเสธ' : 'ไม่สำเร็จ'}</Badge></div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{formatThaiDateTime(item.createdAt)}{item.detail ? ` · ${item.detail}` : ''}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ProfilePreferencesCard({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PreferenceDraft>({
    timezone: me.profile.timezone ?? 'Asia/Bangkok',
    preferredLanguage: me.profile.preferred_language ?? 'th',
    inAppNotifications: me.profile.notification_in_app_enabled ?? true,
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft({
      timezone: me.profile.timezone ?? 'Asia/Bangkok',
      preferredLanguage: me.profile.preferred_language ?? 'th',
      inAppNotifications: me.profile.notification_in_app_enabled ?? true,
    });
    setDirty(false);
  }, [me.profile.notification_in_app_enabled, me.profile.preferred_language, me.profile.timezone]);

  const mutation = useMutation({
    mutationFn: (values: PreferenceDraft) => apiFetch('/api/v1/auth/preferences', { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  function updateDraft(patch: Partial<PreferenceDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary-600" aria-hidden="true" />Notification Preference / ภาษา / Timezone</CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Timezone<select value={draft.timezone} onChange={(event) => updateDraft({ timezone: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">{PROFILE_TIMEZONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Preferred language<select value={draft.preferredLanguage} onChange={(event) => updateDraft({ preferredLanguage: event.target.value as PreferredLanguage })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"><option value="th">ไทย</option><option value="en">English</option></select></label>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"><input type="checkbox" role="switch" checked={draft.inAppNotifications} onChange={(event) => updateDraft({ inAppNotifications: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" /><span><span className="block font-medium text-slate-800 dark:text-slate-100">แสดงการแจ้งเตือนในระบบ</span><span className="mt-0.5 block text-xs font-normal text-slate-500">การตั้งค่าการแจ้งเตือนผ่าน LINE อยู่ในส่วน LINE ด้านล่าง</span></span></label>

        <div className="flex items-center gap-3"><Button type="button" size="sm" onClick={() => mutation.mutate(draft)} disabled={!dirty || mutation.isPending} isLoading={mutation.isPending}>บันทึกการตั้งค่า</Button>{mutation.isSuccess && !dirty && <span className="flex items-center gap-1 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" />บันทึกแล้ว</span>}{mutation.isError && <span className="text-sm text-red-600">{mutation.error instanceof ApiError ? mutation.error.message : 'บันทึกการตั้งค่าไม่สำเร็จ'}</span>}</div>
      </CardBody>
    </Card>
  );
}

function SecurityControlsCard({ session, signOut }: { session: NonNullable<ReturnType<typeof useAuth>['session']>; signOut: () => Promise<void> }) {
  const [signingOut, setSigningOut] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const mfaQuery = useQuery({
    queryKey: ['mfa-factors'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data as MfaFactors;
    },
    enabled: Boolean(session),
  });
  const mfaEnabled = mfaQuery.data?.totp.some((factor) => factor.status === 'verified') ?? false;
  const expiresAt = session.expires_at ? new Date(session.expires_at * 1000) : null;

  async function logoutAllDevices() {
    setShowLogoutConfirm(false);
    setSigningOut(true);
    try {
      // Supabase signOut() defaults to the global scope and revokes all sessions.
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
    <Card>
      <CardHeader className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary-600" aria-hidden="true" />Security</CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"><KeyRound className="h-4 w-4" /></span><div className="min-w-0"><p className="font-semibold text-slate-800 dark:text-slate-100">MFA Setup</p><p className="text-xs text-slate-500">Authenticator สำหรับบัญชีนี้</p></div></div>{mfaQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : mfaEnabled ? <Badge variant="success">เปิดใช้งานแล้ว</Badge> : <Link to="/mfa?setup=1" className="rounded-lg border border-primary-700 px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 dark:text-primary-300">ตั้งค่า MFA</Link>}</div>

        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><Monitor className="h-4 w-4" /></span><div className="min-w-0"><p className="font-semibold text-slate-800 dark:text-slate-100">Active Sessions</p><p className="mt-0.5 truncate text-sm text-slate-600 dark:text-slate-300">{browserName()} · อุปกรณ์นี้</p><p className="mt-1 text-xs text-slate-500">เข้าสู่ระบบล่าสุด {session.user.last_sign_in_at ? formatThaiDateTime(session.user.last_sign_in_at) : 'ไม่ทราบเวลา'}</p></div></div><Badge variant="success">กำลังใช้งาน</Badge></div>{expiresAt && <p className="mt-3 text-xs text-slate-500">Session หมดอายุโดยประมาณ {formatThaiDateTime(expiresAt)}</p>}</div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800"><p className="text-xs text-slate-500">ออกจากระบบทุกอุปกรณ์ที่เคยเข้าสู่ระบบด้วยบัญชีนี้</p><Button type="button" size="sm" variant="danger" onClick={() => setShowLogoutConfirm(true)} disabled={signingOut} isLoading={signingOut}><LogOut className="h-4 w-4" aria-hidden="true" />Logout All Devices</Button></div>
      </CardBody>
    </Card>
    {showLogoutConfirm && <ConfirmModal title="Logout All Devices?" description="ระบบจะยกเลิก session ของบัญชีนี้ทุกอุปกรณ์ และท่านจะต้องเข้าสู่ระบบใหม่" confirmLabel="ออกจากระบบทุกอุปกรณ์" tone="danger" isPending={signingOut} onClose={() => setShowLogoutConfirm(false)} onConfirm={() => void logoutAllDevices()} />}
    </>
  );
}

export function ProfilePage() {
  const { me, session, isMeLoading, meError, refetchMe, hasPermission, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<ProfileForm>({ resolver: zodResolver(profileFormSchema) });

  useEffect(() => {
    if (me) reset({ fullName: me.profile.full_name, phone: me.profile.phone ?? '' });
  }, [me, reset]);

  const mutation = useMutation({
    mutationFn: (values: ProfileForm) => apiFetch('/api/v1/auth/profile', { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isMeLoading) return <div className="flex items-center justify-center py-20" role="status"><Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" /><span className="sr-only">กำลังโหลดข้อมูลโปรไฟล์</span></div>;

  if (!me || !session) {
    return <div className="mx-auto flex max-w-lg flex-col items-center rounded-xl border border-amber-200 bg-amber-50 px-6 py-10 text-center dark:border-amber-900/60 dark:bg-amber-950/30" role="alert"><AlertCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" aria-hidden="true" /><h1 className="mt-3 text-lg font-semibold text-slate-800 dark:text-slate-100">โหลดข้อมูลโปรไฟล์ไม่สำเร็จ</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{meError ? 'ไม่สามารถเชื่อมต่อบริการข้อมูลผู้ใช้ได้ กรุณาลองใหม่' : 'ไม่พบข้อมูลผู้ใช้สำหรับบัญชีนี้'}</p><button type="button" onClick={refetchMe} className="mt-5 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"><RefreshCw className="h-4 w-4" aria-hidden="true" />ลองใหม่</button></div>;
  }

  const initials = me.profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('') || 'IT';
  const permissionModules = new Set(me.permissions.map((permission) => permission.split('.')[0])).size;
  const department = me.employeeDirectory?.department?.name_th ?? 'ยังไม่ได้ระบุใน Employee Master';
  const position = me.employeeDirectory?.position?.name_th ?? 'ยังไม่ได้ระบุใน Employee Master';

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div><h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">โปรไฟล์ของฉัน</h1><p className="mt-1 text-sm text-slate-500">ข้อมูลติดต่อ การตั้งค่าบัญชี และความปลอดภัย</p></div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-[10px] bg-[#0B1B36] p-5 text-white shadow-card"><div className="flex items-center gap-3"><span className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-primary-600 text-lg font-extrabold">{initials}</span><div className="min-w-0"><p className="truncate text-base font-bold">{me.profile.full_name}</p><p className="mt-0.5 truncate font-mono text-[10px] text-white/50">{me.profile.employee_code ?? me.profile.username ?? me.profile.email}</p></div></div><div className="mt-4 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs"><span className={`h-2 w-2 rounded-full ${me.profile.status === 'active' ? 'bg-green-400' : 'bg-slate-400'}`} /><span>{me.profile.status === 'active' ? 'บัญชีพร้อมใช้งาน' : 'บัญชีถูกระงับ'}</span></div><div className="mt-5 grid grid-cols-3 gap-3"><div><p className="text-[10px] text-white/45">บทบาท</p><p className="mt-1 font-mono text-xl font-bold">{me.roles.length}</p></div><div><p className="text-[10px] text-white/45">สิทธิ์</p><p className="mt-1 font-mono text-xl font-bold">{me.permissions.length}</p></div><div><p className="text-[10px] text-white/45">โมดูล</p><p className="mt-1 font-mono text-xl font-bold">{permissionModules}</p></div></div></div>

          <Card><CardHeader className="flex items-center gap-2"><UserRound className="h-4 w-4 text-primary-600" />ข้อมูลติดต่อ</CardHeader><CardBody className="space-y-3 text-sm">{me.profile.username ? <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><KeyRound className="h-4 w-4 text-slate-400" /><span className="min-w-0 truncate">{me.profile.username}<span className="ml-1 text-xs text-slate-400">(ชื่อผู้ใช้เข้าสู่ระบบ)</span></span></p> : <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Mail className="h-4 w-4 text-slate-400" /><span className="min-w-0 truncate">{me.profile.email}</span></p>}<p className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Phone className="h-4 w-4 text-slate-400" />{me.profile.phone || 'ยังไม่ได้ระบุเบอร์โทรศัพท์'}</p></CardBody></Card>

          <Card><CardHeader>ข้อมูลจาก Employee Master</CardHeader><CardBody className="space-y-3 text-sm"><div><p className="text-xs text-slate-500">Department</p><p className="mt-1 font-medium text-slate-800 dark:text-slate-100">{department}</p></div><div><p className="text-xs text-slate-500">Position</p><p className="mt-1 font-medium text-slate-800 dark:text-slate-100">{position}</p></div><p className="border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">ข้อมูลส่วนนี้แก้ไขเองไม่ได้ กรุณาติดต่อผู้ดูแล Employee Master</p></CardBody></Card>

          {hasPermission('technician_skill.view') && <div className="rounded-[10px] border border-hairline bg-slate-50 p-4 dark:border-white/[.08] dark:bg-white/[.03]"><p className="text-xs font-bold text-ink-heading dark:text-slate-100">ตารางทักษะทั้งทีม</p><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">เทียบระดับทักษะของเจ้าหน้าที่ทุกคน</p><Link to="/admin/technician-skills" className="mt-3 inline-block text-xs font-bold text-primary-700 hover:underline dark:text-primary-300">เปิดตารางทักษะช่าง</Link></div>}
        </aside>

        <div className="space-y-4">
          <Card><CardHeader>แก้ไขข้อมูลส่วนตัว</CardHeader><CardBody><form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="grid gap-4 sm:grid-cols-2" noValidate><div className="sm:col-span-2"><span className="mb-1 block text-sm font-medium text-slate-500 dark:text-slate-400">{me.profile.username ? 'ชื่อผู้ใช้เข้าสู่ระบบ' : 'อีเมล'}</span><p className="text-sm text-slate-800 dark:text-slate-200">{me.profile.username ?? me.profile.email}</p></div><div><label htmlFor="fullName" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">ชื่อ-สกุล</label><input id="fullName" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" {...register('fullName')} />{errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>}</div><div><label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">เบอร์โทรศัพท์</label><input id="phone" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" {...register('phone')} />{errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p>}</div><div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" disabled={!isDirty || isSubmitting} isLoading={isSubmitting}>บันทึก</Button>{saved && <span className="flex items-center gap-1 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />บันทึกแล้ว</span>}</div></form></CardBody></Card>

          <ProfilePreferencesCard me={me} />
          {session && <SecurityControlsCard session={session} signOut={signOut} />}
          <LineNotificationCard />
          <SecurityActivityCard />
          <TechnicianSkillPanel />

          <Card><CardHeader className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary-600" />บทบาทและขอบเขตสิทธิ์</CardHeader><CardBody><div className="flex flex-wrap gap-2">{me.roles.map((role) => <Badge key={role.role_key} variant="info">{role.role_name_th}</Badge>)}{me.roles.length === 0 && <span className="text-sm text-slate-500">ยังไม่ได้กำหนดบทบาท</span>}</div><div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-900"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" /><span>บัญชีนี้เข้าถึง {permissionModules} โมดูล จากสิทธิ์ที่มีผลจริง {me.permissions.length} รายการ หากต้องการเปลี่ยนสิทธิ์ให้ติดต่อผู้ดูแลระบบ</span></div></CardBody></Card>
        </div>
      </div>
    </div>
  );
}
