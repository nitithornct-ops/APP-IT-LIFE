import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, Clock3, ExternalLink, Image as ImageIcon, KeyRound, Loader2, Save, Search, Settings2, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { BrandingSettings, SettingsResponse, SettingSupportStatus, SystemSetting } from '../../types/settings';

const STATUS_COPY: Record<SettingSupportStatus, { label: string; className: string }> = {
  active: { label: 'ใช้งานในระบบ', className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200' },
  prepared: { label: 'เตรียมพร้อม', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200' },
  deferred: { label: 'รอ Integration', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200' },
  external: { label: 'จัดการภายนอก', className: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

function errorText(reason: unknown): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : 'ดำเนินการไม่สำเร็จ';
}

function OrganizationLogoSetting({ currentUrl, canManage }: { currentUrl: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState('');
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : currentUrl, [currentUrl, file]);

  useEffect(() => () => {
    if (file && previewUrl !== currentUrl) URL.revokeObjectURL(previewUrl);
  }, [currentUrl, file, previewUrl]);

  const refreshBranding = async () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }),
      queryClient.invalidateQueries({ queryKey: ['branding'] }),
    ]);
  };
  const uploadMutation = useMutation({
    mutationFn: async (logo: File) => {
      const body = new FormData();
      body.set('file', logo);
      return apiFetch<BrandingSettings>('/api/v1/settings/logo', { method: 'POST', body });
    },
    onSuccess: refreshBranding,
  });
  const deleteMutation = useMutation({
    mutationFn: () => apiFetch<BrandingSettings>('/api/v1/settings/logo', { method: 'DELETE' }),
    onSuccess: refreshBranding,
  });

  const selectFile = (selected: File | undefined) => {
    setValidationError('');
    if (!selected) return setFile(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type)) {
      setFile(null);
      return setValidationError('รองรับเฉพาะไฟล์ PNG, JPG และ WebP');
    }
    if (selected.size > 2 * 1024 * 1024) {
      setFile(null);
      return setValidationError('ไฟล์ต้องมีขนาดไม่เกิน 2 MB');
    }
    setFile(selected);
  };

  const mutationError = uploadMutation.error ?? deleteMutation.error;
  return (
    <Card data-testid="organization-logo-setting">
      <CardHeader className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary-600" />ตราสัญลักษณ์หน่วยงาน</CardHeader>
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2 dark:border-slate-600 dark:bg-slate-900">
          {previewUrl ? <img src={previewUrl} alt="ตัวอย่างโลโก้หน่วยงาน" className="h-full w-full object-contain" /> : <ImageIcon className="h-9 w-9 text-slate-300" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800 dark:text-slate-100">โลโก้ที่แสดงใน Sidebar</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">แนะนำภาพพื้นหลังโปร่งใส อัตราส่วน 1:1 ขนาดไม่เกิน 2 MB รองรับ PNG, JPG และ WebP</p>
          {file && <p className="mt-2 truncate text-xs font-medium text-primary-700 dark:text-primary-300">ไฟล์ที่เลือก: {file.name}</p>}
          {(validationError || mutationError) && <p className="mt-2 text-xs text-red-600" role="alert">{validationError || errorText(mutationError)}</p>}
          {canManage ? <div className="mt-3 flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => selectFile(event.target.files?.[0])} />
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><ImageIcon className="h-4 w-4" />เลือกไฟล์</Button>
            {file && <Button size="sm" isLoading={uploadMutation.isPending} onClick={() => uploadMutation.mutate(file)}><Upload className="h-4 w-4" />อัปโหลดโลโก้</Button>}
            {currentUrl && !file && <Button size="sm" variant="danger" isLoading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}><Trash2 className="h-4 w-4" />ลบโลโก้</Button>}
          </div> : <p className="mt-2 flex items-center gap-1 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" />ต้องมีสิทธิ์จัดการ Settings จึงจะเปลี่ยนโลโก้ได้</p>}
        </div>
      </CardBody>
    </Card>
  );
}

export function SettingsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [activeGroup, setActiveGroup] = useState('ทั้งหมด');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const settingsQuery = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => apiFetch<SettingsResponse>('/api/v1/settings') });

  useEffect(() => {
    if (settingsQuery.data) setDrafts(Object.fromEntries(settingsQuery.data.settings.map((setting) => [setting.key, setting.value])));
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => apiFetch<SystemSetting>(`/api/v1/settings/${key}`, { method: 'PATCH', body: JSON.stringify({ value }) }),
    onSuccess: async (updated) => {
      setNotice(`บันทึก ${updated.key} เรียบร้อย`);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('th');
    return (settingsQuery.data?.settings ?? []).filter((setting) => {
      if (setting.key === 'ORG_LOGO_URL') return false;
      if (activeGroup !== 'ทั้งหมด' && setting.group_key !== activeGroup) return false;
      return !keyword || `${setting.key} ${setting.description} ${setting.group_key}`.toLocaleLowerCase('th').includes(keyword);
    });
  }, [activeGroup, search, settingsQuery.data]);

  return (
    <div className="space-y-5" data-testid="settings-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">System Settings</h1><p className="mt-1 text-sm text-slate-500">ค่ากลางแบบ allowlist พร้อม validation และ Audit Trail ทุกครั้งที่แก้ไข</p></div>
        <div className="relative min-w-[260px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาคีย์หรือคำอธิบาย..." className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-800" /></div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        <div className="flex gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-bold">หน้านี้ไม่เก็บหรือแสดง Secret</p><p className="mt-0.5 text-xs leading-5">LINE token, OAuth secret, Supabase key และข้อมูลลับต้องตั้งใน deployment environment เท่านั้น ส่วน Field/PDF Designer ยังคงเลื่อนไปหลัง Go-live ตามมติเดิม</p></div></div>
      </div>

      {settingsQuery.isLoading && <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>}
      {settingsQuery.isError && <EmptyState icon={<Settings2 className="h-10 w-10" />} title="โหลด Settings ไม่สำเร็จ" message={errorText(settingsQuery.error)} />}

      {settingsQuery.data && <>
        <OrganizationLogoSetting currentUrl={settingsQuery.data.settings.find((setting) => setting.key === 'ORG_LOGO_URL')?.value ?? ''} canManage={hasPermission('setting.manage')} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={<Settings2 className="h-5 w-5" />} label="ค่าตั้งค่าทั้งหมด" value={settingsQuery.data.summary.total} tone="primary" />
          <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="แก้ไขผ่านระบบได้" value={settingsQuery.data.summary.editable} tone="teal" />
          <StatCard icon={<Clock3 className="h-5 w-5" />} label="รอ Integration" value={settingsQuery.data.summary.deferred} tone="amber" />
          <StatCard icon={<ExternalLink className="h-5 w-5" />} label="จัดการจากภายนอก" value={settingsQuery.data.summary.externallyManaged} tone="gray" />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {['ทั้งหมด', ...settingsQuery.data.groups].map((group) => <button type="button" key={group} onClick={() => setActiveGroup(group)} className={`whitespace-nowrap rounded-full border px-3 py-2 text-xs font-semibold ${activeGroup === group ? 'border-primary-700 bg-primary-700 text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{group}</button>)}
        </div>

        {notice && <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-700 dark:bg-teal-950/30 dark:text-teal-200" role="status">{notice}</p>}
        {mutation.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200" role="alert">{errorText(mutation.error)}</p>}

        {visible.length ? <div className="space-y-4">
          {[...new Set(visible.map((setting) => setting.group_key))].map((group) => <Card key={group}>
            <CardHeader className="flex items-center justify-between"><span>{group}</span><span className="text-xs font-normal text-slate-400">{visible.filter((setting) => setting.group_key === group).length} ค่า</span></CardHeader>
            <CardBody className="grid gap-4 lg:grid-cols-2">
              {visible.filter((setting) => setting.group_key === group).map((setting) => {
                const changed = drafts[setting.key] !== setting.value;
                const pending = mutation.isPending && mutation.variables?.key === setting.key;
                return <div key={setting.key} data-testid={`setting-card-${setting.key}`} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><code className="text-xs font-bold text-primary-700 dark:text-primary-300">{setting.key}</code><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{setting.description}</p></div><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${STATUS_COPY[setting.support_status].className}`}>{STATUS_COPY[setting.support_status].label}</span></div>
                  <div className="mt-3 flex items-end gap-2"><div className="min-w-0 flex-1"><SettingInput setting={setting} value={drafts[setting.key] ?? setting.value} onChange={(value) => { setDrafts((current) => ({ ...current, [setting.key]: value })); setNotice(''); }} /></div>{hasPermission('setting.manage') && setting.is_editable && <Button aria-label={`บันทึก ${setting.key}`} size="sm" variant={changed ? 'primary' : 'outline'} disabled={!changed} isLoading={pending} onClick={() => mutation.mutate({ key: setting.key, value: drafts[setting.key] ?? setting.value })}><Save className="h-4 w-4" />บันทึก</Button>}</div>
                  {!setting.is_editable && <p className="mt-2 flex items-center gap-1 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" />อ่านอย่างเดียว — จัดการผ่าน deployment หรือระบบภายนอก</p>}
                </div>;
              })}
            </CardBody>
          </Card>)}
        </div> : <EmptyState icon={<Search className="h-10 w-10" />} title="ไม่พบค่าตั้งค่า" message="ลองเปลี่ยนกลุ่มหรือคำค้นหา" />}
      </>}
    </div>
  );
}

function SettingInput({ setting, value, onChange }: { setting: SystemSetting; value: string; onChange: (value: string) => void }) {
  const disabled = !setting.is_editable;
  const base = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:disabled:bg-slate-800';
  if (setting.value_type === 'textarea') return <textarea aria-label={setting.key} rows={3} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className={base} />;
  if (setting.value_type === 'boolean') return <select aria-label={setting.key} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className={base}><option value="true">เปิด (true)</option><option value="false">ปิด (false)</option></select>;
  if (setting.value_type === 'enum') return <select aria-label={setting.key} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className={base}>{setting.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  return <input aria-label={setting.key} disabled={disabled} type={setting.value_type === 'number' ? 'number' : setting.value_type === 'time' ? 'time' : setting.value_type === 'url' ? 'url' : 'text'} min={setting.min_value ?? undefined} max={setting.max_value ?? undefined} value={value} onChange={(event) => onChange(event.target.value)} className={base} />;
}
