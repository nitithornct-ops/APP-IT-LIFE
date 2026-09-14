import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, CheckCircle2, CheckCheck, Clock3, Download, ExternalLink, GitCompareArrows, History, Image as ImageIcon, KeyRound, Loader2, RotateCcw, Save, Search, Settings2, ShieldAlert, ShieldCheck, Trash2, Upload, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmModal, FormModal } from '../../components/ui/Modal';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { BrandingSettings, SettingChangeRequest, SettingHistoryResponse, SettingMutationResult, SettingPreviewResponse, SettingsResponse, SettingSupportStatus, SystemSetting } from '../../types/settings';
import { SlaSettingsOverview } from './SlaSettingsOverview';
import { TicketRatingCriteriaSetting } from './TicketRatingCriteriaSetting';

const STATUS_COPY: Record<SettingSupportStatus, { label: string; className: string }> = {
  active: { label: 'ใช้งานในระบบ', className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200' },
  prepared: { label: 'เตรียมพร้อม', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200' },
  deferred: { label: 'รอ Integration', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200' },
  external: { label: 'จัดการภายนอก', className: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

function errorText(reason: unknown): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : 'ดำเนินการไม่สำเร็จ';
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function isCritical(setting: SystemSetting): boolean {
  return setting.criticality === 'critical' || setting.requires_approval === true;
}

function mutationSetting(result: SystemSetting | SettingMutationResult): SystemSetting | undefined {
  if ('setting' in result) return result.setting;
  return result as SystemSetting;
}

function environmentBadgeClass(key: string): string {
  if (key === 'prod') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200';
  if (key === 'uat') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200';
  return 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200';
}

function SettingPreviewModal({ preview, onClose }: { preview: SettingPreviewResponse; onClose: () => void }) {
  return (
    <FormModal title={`Preview: ${preview.key}`} description="ตรวจสอบค่าก่อนบันทึกหรือส่งอนุมัติ" icon={<GitCompareArrows className="h-5 w-5" />} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>ปิด</Button>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><p className="text-xs text-slate-500">ค่าปัจจุบัน · v{preview.current.version}</p><p className="mt-1 break-words font-mono text-sm">{preview.current.value || '(ว่าง)'}</p></div>
          <div className="rounded-lg border border-primary-200 bg-primary-50/50 p-3 dark:border-primary-800 dark:bg-primary-950/20"><p className="text-xs text-primary-700 dark:text-primary-300">ค่าที่เสนอ</p><p className="mt-1 break-words font-mono text-sm">{preview.proposed.value || '(ว่าง)'}</p></div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2 py-1 font-semibold ${preview.changed ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{preview.changed ? 'มีการเปลี่ยนแปลง' : 'ค่าเดิม'}</span>
          <span className={`rounded-full px-2 py-1 font-semibold ${preview.requiresApproval ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' : 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200'}`}>{preview.requiresApproval ? 'ต้องอนุมัติ · Critical' : 'บันทึกได้ทันที'}</span>
        </div>
        {preview.dependencies.length > 0 && <div><p className="mb-2 text-xs font-bold text-slate-600 dark:text-slate-300">Setting dependency</p><div className="space-y-2">{preview.dependencies.map((dependency) => <div key={dependency.key} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900"><span className="font-mono">{dependency.key}</span><span className={dependency.status === 'satisfied' ? 'text-teal-700 dark:text-teal-300' : 'text-amber-700 dark:text-amber-300'}>{dependency.status}{dependency.value ? ` · ${dependency.value}` : ''}</span></div>)}</div></div>}
        {preview.impactedSettings.length > 0 && <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">มีผลต่อ: {preview.impactedSettings.join(', ')}</p>}
        {preview.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p className="mb-1 flex items-center gap-1 font-bold"><AlertTriangle className="h-3.5 w-3.5" />ข้อควรทราบ</p>{preview.warnings.map((warning) => <p key={warning}>• {warning}</p>)}</div>}
      </div>
    </FormModal>
  );
}

function SettingHistoryModal({ setting, canRestore, onClose, onRestored }: { setting: SystemSetting; canRestore: boolean; onClose: () => void; onRestored: (status: string) => void }) {
  const queryClient = useQueryClient();
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const historyQuery = useQuery({
    queryKey: ['admin', 'settings', setting.key, 'history'],
    queryFn: () => apiFetch<SettingHistoryResponse>(`/api/v1/settings/${setting.key}/history`),
  });
  const restoreMutation = useMutation({
    mutationFn: (version: number) => apiFetch<SystemSetting | SettingMutationResult>(`/api/v1/settings/${setting.key}/restore`, { method: 'POST', body: JSON.stringify({ version }) }),
    onSuccess: (result) => {
      const envelope = 'setting' in result;
      onRestored(envelope && result.status === 'pending' ? 'ส่งคำขอคืนค่าเดิมแล้ว รอผู้มีสิทธิ์อนุมัติ' : 'คืนค่าก่อนหน้าเรียบร้อย');
      setRestoreVersion(null);
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });
  const entries = historyQuery.data?.history ?? [];
  const currentVersion = historyQuery.data?.currentVersion ?? setting.config_version ?? 1;
  const selectedEntry = entries.find((entry) => entry.version === restoreVersion);

  return <>
    <FormModal title={`ประวัติ ${setting.key}`} description={`Config version ปัจจุบัน v${currentVersion}`} icon={<History className="h-5 w-5" />} onClose={onClose} size="lg" footer={<Button variant="outline" onClick={onClose}>ปิด</Button>}>
      {historyQuery.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>}
      {historyQuery.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{errorText(historyQuery.error)}</p>}
      {!historyQuery.isLoading && !historyQuery.isError && entries.length === 0 && <p className="py-6 text-center text-sm text-slate-500">ยังไม่มีประวัติการเปลี่ยนแปลง</p>}
      {entries.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="px-2 py-2">Version</th><th className="px-2 py-2">ค่า</th><th className="px-2 py-2">ประเภท</th><th className="px-2 py-2">Environment</th><th className="px-2 py-2">เวลา</th><th className="px-2 py-2" /></tr></thead><tbody>{entries.map((entry) => { const isCurrent = entry.version === currentVersion; return <tr key={entry.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-2 py-2 font-mono text-xs">v{entry.version}{isCurrent && <span className="ml-1 text-teal-600">ปัจจุบัน</span>}</td><td className="max-w-[280px] break-words px-2 py-2 font-mono text-xs">{entry.value || '(ว่าง)'}</td><td className="px-2 py-2 text-xs text-slate-500">{entry.change_type === 'initial' ? 'เริ่มต้น' : entry.change_type === 'restore' ? `คืนค่า v${entry.source_version ?? '—'}` : 'แก้ไข'}</td><td className="px-2 py-2 text-xs uppercase text-slate-500">{entry.environment_label}</td><td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{formatDate(entry.created_at)}</td><td className="px-2 py-2 text-right">{canRestore && !isCurrent && <Button size="sm" variant="outline" onClick={() => setRestoreVersion(entry.version)}><RotateCcw className="h-3.5 w-3.5" />คืนค่านี้</Button>}</td></tr>; })}</tbody></table></div>}
      {restoreMutation.isError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{errorText(restoreMutation.error)}</p>}
    </FormModal>
    {selectedEntry && <ConfirmModal title={`คืนค่า ${setting.key} เป็น v${selectedEntry.version}?`} description={isCritical(setting) ? 'ค่านี้เป็น Critical จึงจะถูกส่งให้ผู้มีสิทธิ์อนุมัติก่อนมีผล' : 'ระบบจะบันทึกเป็น Config version ใหม่ และเก็บค่าปัจจุบันไว้ในประวัติ'} confirmLabel={isCritical(setting) ? 'ส่งขอคืนค่า' : 'ยืนยันคืนค่า'} isPending={restoreMutation.isPending} onClose={() => setRestoreVersion(null)} onConfirm={() => restoreMutation.mutate(selectedEntry.version)}>{<p className="break-words text-sm text-slate-600 dark:text-slate-300">ค่าที่จะนำกลับมาใช้: <code>{selectedEntry.value || '(ว่าง)'}</code></p>}</ConfirmModal>}
  </>;
}

function SettingApprovalQueue({ requests, settings, canApprove, currentUserId, onNotice, onRefresh }: { requests: SettingChangeRequest[]; settings: SystemSetting[]; canApprove: boolean; currentUserId?: string; onNotice: (message: string) => void; onRefresh: () => void }) {
  const decisionMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => apiFetch<{ status: string; setting?: SystemSetting }>(`/api/v1/settings/approvals/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision }) }),
    onSuccess: (result) => {
      onNotice(result.status === 'approved' ? 'อนุมัติการเปลี่ยนค่าและนำไปใช้แล้ว' : 'ปฏิเสธคำขอเปลี่ยนค่าแล้ว');
      onRefresh();
    },
  });
  const settingByKey = new Map(settings.map((setting) => [setting.key, setting]));

  if (!requests.length) return null;
  return <Card data-testid="settings-approval-queue">
    <CardHeader className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-red-600" />คิวอนุมัติค่าระดับ Critical <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-200">{requests.length}</span></CardHeader>
    <CardBody className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">การเปลี่ยนค่าระดับ Critical ต้องผ่านผู้อนุมัติอีกคนหนึ่งก่อน จึงจะมีผลในระบบ</p>
      {requests.map((request) => {
        const setting = settingByKey.get(request.setting_key);
        const ownRequest = request.requested_by === currentUserId;
        return <div key={request.id} className="rounded-xl border border-red-100 bg-red-50/40 p-3 dark:border-red-900/50 dark:bg-red-950/20">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><code className="text-xs font-bold text-primary-700 dark:text-primary-300">{request.setting_key}</code><p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{setting?.description ?? 'คำขอเปลี่ยนค่าตั้งค่า'}</p></div><span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 dark:bg-slate-800">Base v{request.base_version}</span></div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><div><span className="text-slate-500">ค่าที่เสนอ</span><p className="break-words font-mono text-sm">{request.requested_value || '(ว่าง)'}</p></div><div><span className="text-slate-500">ประเภท</span><p>{request.change_type === 'restore' ? `คืนค่า v${request.source_version ?? '—'}` : 'แก้ไขค่า'}</p></div><div><span className="text-slate-500">ส่งเมื่อ</span><p>{formatDate(request.created_at)}</p></div></div>
          {canApprove && <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{ownRequest ? <p className="mr-auto text-xs text-amber-700 dark:text-amber-300">ผู้ยื่นไม่สามารถอนุมัติคำขอของตนเองได้</p> : <><Button size="sm" variant="outline" disabled={decisionMutation.isPending} onClick={() => decisionMutation.mutate({ id: request.id, decision: 'reject' })}><XCircle className="h-3.5 w-3.5" />ปฏิเสธ</Button><Button size="sm" variant="success" isLoading={decisionMutation.isPending && decisionMutation.variables?.id === request.id && decisionMutation.variables.decision === 'approve'} onClick={() => decisionMutation.mutate({ id: request.id, decision: 'approve' })}><CheckCheck className="h-3.5 w-3.5" />อนุมัติและใช้ค่า</Button></>}</div>}
          {decisionMutation.isError && <p className="mt-2 text-xs text-red-700" role="alert">{errorText(decisionMutation.error)}</p>}
        </div>;
      })}
    </CardBody>
  </Card>;
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
  const { hasPermission, me } = useAuth();
  const queryClient = useQueryClient();
  const [activeGroup, setActiveGroup] = useState('ทั้งหมด');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [previewTarget, setPreviewTarget] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<SystemSetting | null>(null);
  const settingsQuery = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => apiFetch<SettingsResponse>('/api/v1/settings') });

  useEffect(() => {
    if (settingsQuery.data) setDrafts(Object.fromEntries(settingsQuery.data.settings.map((setting) => [setting.key, setting.value])));
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => apiFetch<SystemSetting | SettingMutationResult>(`/api/v1/settings/${key}`, { method: 'PATCH', body: JSON.stringify({ value }) }),
    onSuccess: async (result) => {
      const updated = mutationSetting(result);
      setNotice(result && 'status' in result && result.status === 'pending' ? 'ส่งคำขอเปลี่ยนค่า Critical แล้ว รอผู้อนุมัติ' : `บันทึก ${updated?.key ?? 'ค่าตั้งค่า'} เรียบร้อย`);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });
  const previewMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => apiFetch<SettingPreviewResponse>('/api/v1/settings/preview', { method: 'POST', body: JSON.stringify({ key, value }) }),
    onError: () => setPreviewTarget(null),
  });
  const exportMutation = useMutation({
    mutationFn: () => apiFetch<{ filename: string; [key: string]: unknown }>('/api/v1/settings/export'),
    onSuccess: ({ filename, ...data }) => downloadJson(filename, data),
  });

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('th');
    return (settingsQuery.data?.settings ?? []).filter((setting) => {
      if (setting.key === 'ORG_LOGO_URL') return false;
      if (activeGroup !== 'ทั้งหมด' && setting.group_key !== activeGroup) return false;
      return !keyword || `${setting.key} ${setting.description} ${setting.group_key}`.toLocaleLowerCase('th').includes(keyword);
    });
  }, [activeGroup, search, settingsQuery.data]);

  const pendingChanges = settingsQuery.data?.pendingChanges ?? [];
  const pendingKeys = new Set(pendingChanges.map((request) => request.setting_key));
  const preview = previewMutation.data;

  return (
    <div className="space-y-5" data-testid="settings-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle eyebrow="ตั้งค่าและบัญชี / System Settings" title="System Settings" description="ค่ากลางแบบ allowlist พร้อม validation และ Audit Trail ทุกครั้งที่แก้ไข" />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span data-testid="settings-environment" className={`rounded-full border px-2.5 py-1 text-xs font-bold ${environmentBadgeClass(settingsQuery.data?.environment?.key ?? 'unknown')}`}>Environment: {settingsQuery.data?.environment?.label ?? '—'}</span>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Config v{settingsQuery.data?.summary.configVersion ?? 1}</span>
          <Button size="sm" variant="outline" isLoading={exportMutation.isPending} onClick={() => exportMutation.mutate()}><Download className="h-4 w-4" />Export Sanitized</Button>
          <div className="relative min-w-[220px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาคีย์หรือคำอธิบาย..." className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-800" /></div>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        <div className="flex gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-bold">หน้านี้ไม่เก็บหรือแสดง Secret</p><p className="mt-0.5 text-xs leading-5">LINE token, OAuth secret, Supabase key และข้อมูลลับต้องตั้งใน deployment environment เท่านั้น ส่วน Field/PDF Designer ยังคงเลื่อนไปหลัง Go-live ตามมติเดิม</p></div></div>
      </div>

      {settingsQuery.isLoading && <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>}
      {settingsQuery.isError && <EmptyState icon={<Settings2 className="h-10 w-10" />} title="โหลด Settings ไม่สำเร็จ" message={errorText(settingsQuery.error)} />}

      {settingsQuery.data && <>
        <OrganizationLogoSetting currentUrl={settingsQuery.data.settings.find((setting) => setting.key === 'ORG_LOGO_URL')?.value ?? ''} canManage={hasPermission('setting.manage')} />
        <TicketRatingCriteriaSetting canManage={hasPermission('setting.manage')} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <StatCard icon={<Settings2 className="h-5 w-5" />} label="ค่าตั้งค่าทั้งหมด" value={settingsQuery.data.summary.total} tone="primary" />
          <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="แก้ไขผ่านระบบได้" value={settingsQuery.data.summary.editable} tone="teal" />
          <StatCard icon={<Clock3 className="h-5 w-5" />} label="รอ Integration" value={settingsQuery.data.summary.deferred} tone="amber" />
          <StatCard icon={<ExternalLink className="h-5 w-5" />} label="จัดการจากภายนอก" value={settingsQuery.data.summary.externallyManaged} tone="gray" />
          <StatCard icon={<ShieldAlert className="h-5 w-5" />} label="ค่าระดับ Critical" value={settingsQuery.data.summary.critical ?? 0} tone="danger" />
          <StatCard icon={<GitCompareArrows className="h-5 w-5" />} label="รออนุมัติ" value={settingsQuery.data.summary.pendingApprovals ?? 0} tone="amber" />
        </div>

        <SettingApprovalQueue requests={pendingChanges} settings={settingsQuery.data.settings} canApprove={settingsQuery.data.capabilities?.canApprove === true && hasPermission('setting.approve')} currentUserId={me?.profile.id} onNotice={setNotice} onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })} />

        <SlaSettingsOverview settings={settingsQuery.data.settings} drafts={drafts} />

        <div className="grid min-w-0 gap-4 lg:grid-cols-[198px_minmax(0,1fr)]">
          <nav className="h-fit rounded-[10px] border border-slate-200 bg-white p-2 shadow-card dark:border-slate-700 dark:bg-slate-800" aria-label="หมวดการตั้งค่า">
            <p className="px-2 pb-2 pt-1 font-mono text-[10px] font-semibold tracking-wider text-slate-400">SETTING GROUPS</p>
            {['ทั้งหมด', ...settingsQuery.data.groups].map((group) => <button type="button" key={group} onClick={() => setActiveGroup(group)} className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold ${activeGroup === group ? 'bg-primary-50 text-primary-700 shadow-[inset_3px_0_0_#1D4ED8] dark:bg-primary-950/40 dark:text-primary-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}><span className="truncate">{group}</span><span className="font-mono text-[10px] text-slate-400">{group === 'ทั้งหมด' ? settingsQuery.data.settings.length : settingsQuery.data.settings.filter((setting) => setting.group_key === group).length}</span></button>)}
          </nav>

          <div className="min-w-0 space-y-4">
        {notice && <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-700 dark:bg-teal-950/30 dark:text-teal-200" role="status">{notice}</p>}
        {mutation.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200" role="alert">{errorText(mutation.error)}</p>}

        {visible.length ? <div className="space-y-4">
          {[...new Set(visible.map((setting) => setting.group_key))].map((group) => <Card key={group}>
            <CardHeader className="flex items-center justify-between"><span>{group}</span><span className="text-xs font-normal text-slate-400">{visible.filter((setting) => setting.group_key === group).length} ค่า</span></CardHeader>
            <CardBody className="grid gap-4 lg:grid-cols-2">
              {visible.filter((setting) => setting.group_key === group).map((setting) => {
                const changed = drafts[setting.key] !== setting.value;
                const pending = mutation.isPending && mutation.variables?.key === setting.key;
                const hasPendingRequest = pendingKeys.has(setting.key);
                return <div key={setting.key} data-testid={`setting-card-${setting.key}`} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><code className="text-xs font-bold text-primary-700 dark:text-primary-300">{setting.key}</code><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{setting.description}</p></div><div className="flex flex-wrap items-center justify-end gap-1"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${STATUS_COPY[setting.support_status].className}`}>{STATUS_COPY[setting.support_status].label}</span>{isCritical(setting) && <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-200">Critical</span>}<span className="rounded-full bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-500 dark:bg-slate-700 dark:text-slate-300">v{setting.config_version ?? 1}</span></div></div>
                  {setting.depends_on && setting.depends_on.length > 0 && <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Dependency: <span className="font-mono">{setting.depends_on.join(', ')}</span></p>}
                  {hasPendingRequest && <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300"><Clock3 className="h-3.5 w-3.5" />มีคำขอเปลี่ยนค่ารออนุมัติ</p>}
                  <div className="mt-3 flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><SettingInput setting={setting} value={drafts[setting.key] ?? setting.value} onChange={(value) => { setDrafts((current) => ({ ...current, [setting.key]: value })); setNotice(''); }} /></div><div className="flex flex-wrap gap-2">{changed && <Button aria-label={`ดู Preview ${setting.key}`} size="sm" variant="outline" isLoading={previewMutation.isPending && previewTarget === setting.key} onClick={() => { previewMutation.reset(); setPreviewTarget(setting.key); previewMutation.mutate({ key: setting.key, value: drafts[setting.key] ?? setting.value }); }}><GitCompareArrows className="h-4 w-4" />Preview</Button>}{hasPermission('setting.manage') && setting.is_editable && <Button aria-label={`บันทึก ${setting.key}`} size="sm" variant={changed ? 'primary' : 'outline'} disabled={!changed || hasPendingRequest} isLoading={pending} onClick={() => mutation.mutate({ key: setting.key, value: drafts[setting.key] ?? setting.value })}><Save className="h-4 w-4" />{isCritical(setting) ? 'ส่งขออนุมัติ' : 'บันทึก'}</Button>}<Button aria-label={`ดูประวัติ ${setting.key}`} size="sm" variant="ghost" onClick={() => setHistoryTarget(setting)}><History className="h-4 w-4" />ประวัติ</Button></div></div>
                  {!setting.is_editable && <p className="mt-2 flex items-center gap-1 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" />อ่านอย่างเดียว — จัดการผ่าน deployment หรือระบบภายนอก</p>}
                </div>;
              })}
            </CardBody>
          </Card>)}
        </div> : <EmptyState icon={<Search className="h-10 w-10" />} title="ไม่พบค่าตั้งค่า" message="ลองเปลี่ยนกลุ่มหรือคำค้นหา" />}
          </div>
        </div>
        {preview && previewTarget === preview.key && <SettingPreviewModal preview={preview} onClose={() => { setPreviewTarget(null); previewMutation.reset(); }} />}
        {historyTarget && <SettingHistoryModal setting={historyTarget} canRestore={hasPermission('setting.manage') && historyTarget.is_editable} onClose={() => setHistoryTarget(null)} onRestored={(message) => { setNotice(message); void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }); }} />}
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
