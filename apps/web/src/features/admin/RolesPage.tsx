import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, GitCompareArrows, History, Loader2, LockKeyhole, Plus, ShieldAlert, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { RowActions } from '../../components/table/RowActions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { FormModal } from '../../components/ui/Modal';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { Role, RoleOwner, RoleVersion, RoleVersionComparison } from '../../types/admin';
import { formatThaiDateTime } from '../../utils/date';

const reviewFrequencyLabels: Record<Role['review_frequency'], string> = {
  monthly: 'ทุกเดือน',
  quarterly: 'ทุกไตรมาส',
  semiannual: 'ทุก 6 เดือน',
  annual: 'ทุกปี',
};

const roleFormSchema = z.object({
  key: z.string().trim().min(2, 'อย่างน้อย 2 ตัวอักษร').max(50, 'ไม่เกิน 50 ตัวอักษร').regex(/^[a-z][a-z0-9_]*$/, 'ใช้ตัวพิมพ์เล็ก a-z0-9_ และขึ้นต้นด้วยตัวอักษรเท่านั้น'),
  nameTh: z.string().trim().min(1, 'กรุณากรอกชื่อบทบาท').max(200),
  nameEn: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  scope: z.string().trim().max(1000).optional(),
  ownerId: z.string().uuid('Role Owner ไม่ถูกต้อง').optional().or(z.literal('')),
  reviewFrequency: z.enum(['monthly', 'quarterly', 'semiannual', 'annual']),
  sensitiveRole: z.boolean(),
  status: z.enum(['active', 'inactive']),
});

type RoleFormValues = z.infer<typeof roleFormSchema>;

function emptyRoleForm(role?: Role, cloneFrom?: Role): RoleFormValues {
  const source = role ?? cloneFrom;
  return {
    key: role?.key ?? (cloneFrom ? `${cloneFrom.key}_copy`.slice(0, 50) : ''),
    nameTh: role?.name_th ?? (cloneFrom ? `${cloneFrom.name_th} (สำเนา)` : ''),
    nameEn: role?.name_en ?? cloneFrom?.name_en ?? '',
    description: role?.description ?? cloneFrom?.description ?? '',
    scope: role?.scope ?? cloneFrom?.scope ?? '',
    ownerId: source?.owner_id ?? '',
    reviewFrequency: source?.review_frequency ?? 'quarterly',
    sensitiveRole: source?.sensitive_role ?? false,
    status: role?.status ?? 'active',
  };
}

function RoleEditor({ role, cloneFrom, owners, onClose }: { role?: Role; cloneFrom?: Role; owners: RoleOwner[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const isEditing = Boolean(role);
  const isCloning = Boolean(cloneFrom);
  const { register, handleSubmit, formState: { errors } } = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: emptyRoleForm(role, cloneFrom),
  });

  const mutation = useMutation({
    mutationFn: (values: RoleFormValues) => {
      const body = {
        ...values,
        nameEn: values.nameEn?.trim() || null,
        description: values.description?.trim() || null,
        scope: values.scope?.trim() || null,
        ownerId: values.ownerId || null,
      };
      if (isEditing && role) return apiFetch<Role>(`/api/v1/roles/${role.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (isCloning && cloneFrom) return apiFetch<Role>(`/api/v1/roles/${cloneFrom.id}/clone`, { method: 'POST', body: JSON.stringify(body) });
      return apiFetch<Role>('/api/v1/roles', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'บันทึกบทบาทไม่สำเร็จ'),
  });

  return (
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="grid grid-cols-1 gap-4" noValidate>
      <div className="flex items-center justify-between rounded-lg bg-primary-50 px-3 py-2 dark:bg-primary-900/30">
        <div><p className="text-sm font-semibold text-primary-900 dark:text-primary-100">{isEditing ? 'แก้ไขบทบาท' : isCloning ? 'คัดลอกบทบาท' : 'สร้างบทบาทใหม่'}</p><p className="text-xs text-primary-700/80 dark:text-primary-200/80">กำหนด metadata การกำกับดูแลก่อนเชื่อมกับ Permission Matrix</p></div>
        <button type="button" onClick={onClose} aria-label="ปิดฟอร์ม"><X className="h-4 w-4 text-primary-700" /></button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label htmlFor="role-key" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Role key</label><input id="role-key" data-autofocus disabled={isEditing} placeholder="เช่น service_desk_lead" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:disabled:bg-slate-700" {...register('key')} />{isEditing && <p className="mt-1 text-[11px] text-slate-500">Role key ใช้เป็นรหัสอ้างอิงและเปลี่ยนภายหลังไม่ได้</p>}{errors.key && <p className="mt-1 text-xs text-red-600">{errors.key.message}</p>}</div>
        <div><label htmlFor="role-name-th" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อบทบาท (ไทย)</label><input id="role-name-th" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('nameTh')} />{errors.nameTh && <p className="mt-1 text-xs text-red-600">{errors.nameTh.message}</p>}</div>
        <div><label htmlFor="role-name-en" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อบทบาท (อังกฤษ)</label><input id="role-name-en" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('nameEn')} /></div>
        <div><label htmlFor="role-owner" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Role Owner</label><select id="role-owner" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('ownerId')}><option value="">— ยังไม่กำหนด —</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.full_name} — {owner.email}</option>)}</select>{errors.ownerId && <p className="mt-1 text-xs text-red-600">{errors.ownerId.message}</p>}</div>
        <div><label htmlFor="role-review-frequency" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Review Frequency</label><select id="role-review-frequency" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('reviewFrequency')}>{Object.entries(reviewFrequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        {isEditing && <div><label htmlFor="role-status" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานะ</label><select id="role-status" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('status')}><option value="active">เปิดใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select></div>}
      </div>
      <div><label htmlFor="role-scope" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Description / Scope</label><textarea id="role-scope" rows={2} placeholder="ขอบเขตระบบ หน่วยงาน หรือข้อมูลที่บทบาทนี้รับผิดชอบ" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('scope')} />{errors.scope && <p className="mt-1 text-xs text-red-600">{errors.scope.message}</p>}</div>
      <div><label htmlFor="role-description" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">คำอธิบายบทบาท</label><textarea id="role-description" rows={2} placeholder="หน้าที่และเหตุผลทางธุรกิจของบทบาทนี้" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('description')} />{errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}</div>
      <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-primary-600" {...register('sensitiveRole')} />Sensitive Role — บทบาทความเสี่ยงสูง/เข้าถึงข้อมูลสำคัญ</label>
      {serverError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{serverError}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-700"><Button type="button" variant="outline" size="sm" onClick={onClose}>ยกเลิก</Button><Button type="submit" size="sm" isLoading={mutation.isPending}>{isEditing ? 'บันทึกการแก้ไข' : isCloning ? 'สร้างสำเนาบทบาท' : 'สร้างบทบาท'}</Button></div>
    </form>
  );
}

function displayDiffValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'เปิด' : 'ปิด';
  return String(value);
}

function RoleVersionModal({ role, onClose }: { role: Role; onClose: () => void }) {
  const [fromVersion, setFromVersion] = useState<number | ''>('');
  const [toVersion, setToVersion] = useState<number | ''>('');
  const versionsQuery = useQuery({ queryKey: ['admin', 'roles', role.id, 'versions'], queryFn: () => apiFetch<RoleVersion[]>(`/api/v1/roles/${role.id}/versions`) });
  const versions = useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  useEffect(() => {
    if (versions.length < 2 || fromVersion !== '' || toVersion !== '') return;
    const ordered = [...versions].sort((a, b) => a.version_number - b.version_number);
    setFromVersion(ordered[0].version_number);
    setToVersion(ordered[ordered.length - 1].version_number);
  }, [fromVersion, toVersion, versions]);
  const comparisonQuery = useQuery({
    queryKey: ['admin', 'roles', role.id, 'versions', 'compare', fromVersion, toVersion],
    queryFn: () => apiFetch<RoleVersionComparison>(`/api/v1/roles/${role.id}/versions/compare?from=${fromVersion}&to=${toVersion}`, undefined, { silent: true }),
    enabled: typeof fromVersion === 'number' && typeof toVersion === 'number' && fromVersion !== toVersion,
  });
  return <FormModal title={`ประวัติเวอร์ชัน — ${role.name_th}`} description="ตรวจสอบการเปลี่ยนแปลง metadata และ Permission Matrix ย้อนหลัง" size="lg" onClose={onClose}>
    {versionsQuery.isLoading && <div className="flex justify-center py-8" role="status"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
    {versionsQuery.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">โหลดประวัติเวอร์ชันไม่สำเร็จ</p>}
    {versions.length > 0 && <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">เปรียบเทียบจาก<select value={fromVersion} onChange={(event) => setFromVersion(event.target.value ? Number(event.target.value) : '')} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">— เลือกเวอร์ชัน —</option>{versions.map((version) => <option key={version.id} value={version.version_number}>Version {version.version_number} · {version.change_type}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">เปรียบเทียบกับ<select value={toVersion} onChange={(event) => setToVersion(event.target.value ? Number(event.target.value) : '')} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">— เลือกเวอร์ชัน —</option>{versions.map((version) => <option key={version.id} value={version.version_number}>Version {version.version_number} · {version.change_type}</option>)}</select></label>
      </div>
      {versions.length < 2 && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-900">บทบาทนี้มีเพียง Version 1 ยังไม่มีเวอร์ชันอื่นให้เปรียบเทียบ</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500 dark:bg-slate-900"><tr><th className="px-3 py-2">Version</th><th className="px-3 py-2">ประเภท</th><th className="px-3 py-2">รายละเอียด</th><th className="px-3 py-2">บันทึกเมื่อ</th></tr></thead><tbody>{versions.map((version) => <tr key={version.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-3 py-2 font-mono font-bold">v{version.version_number} {version.version_number === role.version && <Badge variant="success">ปัจจุบัน</Badge>}</td><td className="px-3 py-2"><Badge variant="secondary">{version.change_type}</Badge></td><td className="px-3 py-2">{version.change_summary ?? '—'}</td><td className="px-3 py-2 text-slate-500">{formatThaiDateTime(version.created_at)}</td></tr>)}</tbody></table></div>
      {comparisonQuery.isLoading && <div className="flex items-center gap-2 text-xs text-slate-500" role="status"><Loader2 className="h-4 w-4 animate-spin" />กำลังเปรียบเทียบ...</div>}
      {comparisonQuery.data && <div className="rounded-lg border border-primary-100 dark:border-primary-900"><div className="flex items-center gap-2 border-b border-primary-100 bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-900 dark:border-primary-900 dark:bg-primary-950/40 dark:text-primary-100"><GitCompareArrows className="h-4 w-4" />v{comparisonQuery.data.from.version_number} → v{comparisonQuery.data.to.version_number}<span className="ml-auto text-xs font-normal">เปลี่ยนแปลง {comparisonQuery.data.changes.length} รายการ</span></div>{comparisonQuery.data.changes.length === 0 ? <p className="p-3 text-xs text-slate-500">ไม่พบความแตกต่างของ snapshot</p> : <div className="divide-y divide-slate-100 dark:divide-slate-700">{comparisonQuery.data.changes.map((change) => <div key={change.field} className="grid gap-1 px-3 py-2 sm:grid-cols-[1.1fr_1fr_1fr]"><span className="font-semibold text-slate-700 dark:text-slate-200">{change.label}</span><span className="text-rose-700 dark:text-rose-300">เดิม: {displayDiffValue(change.from)}</span><span className="text-emerald-700 dark:text-emerald-300">ใหม่: {displayDiffValue(change.to)}</span></div>)}</div>}</div>}
    </div>}
  </FormModal>;
}

export function RolesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('role.manage');
  const [modal, setModal] = useState<'create' | 'edit' | 'clone' | 'versions' | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const rolesQuery = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => apiFetch<Role[]>('/api/v1/roles') });
  const ownersQuery = useQuery({ queryKey: ['admin', 'role-owners'], queryFn: () => apiFetch<RoleOwner[]>('/api/v1/roles/owners'), enabled: canManage });
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const conflictRoles = useMemo(() => roles.filter((role) => (role.sod_conflict_count ?? 0) > 0).length, [roles]);
  function openEditor(nextModal: 'create' | 'edit' | 'clone', role?: Role) { setSelectedRole(role ?? null); setModal(nextModal); }
  const closeModal = () => { setModal(null); setSelectedRole(null); };

  return <div>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><PageTitle eyebrow="บุคลากรและสิทธิ์ / บทบาท" title="บทบาทและสิทธิ์" description="กำกับดูแลเจ้าของบทบาท ขอบเขตการใช้งาน รอบทบทวน ความเสี่ยง และประวัติ Permission Matrix" /><div className="flex items-center gap-2"><Link to="/admin/permission-matrix" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200">Permission Matrix</Link><RequirePermission permission="role.manage"><Button size="sm" onClick={() => openEditor('create')}><Plus className="h-4 w-4" />สร้างบทบาทใหม่</Button></RequirePermission></div></div>
    {rolesQuery.data && <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5"><StatCardLike icon={<ShieldCheck className="h-5 w-5" />} label="บทบาททั้งหมด" value={roles.length} tone="primary" /><StatCardLike icon={<LockKeyhole className="h-5 w-5" />} label="บทบาทระบบ (ล็อก)" value={roles.filter((role) => role.is_system).length} tone="teal" /><StatCardLike icon={<UsersRound className="h-5 w-5" />} label="กำหนดเอง" value={roles.filter((role) => !role.is_system).length} tone="amber" /><StatCardLike icon={<UserRound className="h-5 w-5" />} label="Role Owner" value={roles.filter((role) => role.owner_id).length} tone="gray" /><StatCardLike icon={<ShieldAlert className="h-5 w-5" />} label="มี SoD Conflict" value={conflictRoles} tone={conflictRoles ? 'danger' : 'gray'} /></div>}
    {rolesQuery.isLoading && <div className="flex justify-center py-10" role="status"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
    {rolesQuery.isError && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">โหลดรายการบทบาทไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</p>}
    {rolesQuery.data && <Card><CardBody className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400"><tr><th className="px-4 py-3">บทบาท</th><th className="px-4 py-3">Owner / Scope</th><th className="px-4 py-3">Review</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">ผู้ใช้งาน</th><th className="px-4 py-3">SoD Conflict</th><th className="px-4 py-3">ประเภท</th><th className="px-4 py-3 text-right">ดำเนินการ</th></tr></thead><tbody>
      {roles.map((role) => <tr key={role.id} className="border-t border-slate-100 align-top dark:border-slate-700"><td className="px-4 py-3"><div className="font-semibold text-slate-800 dark:text-slate-100">{role.name_th}</div><div className="mt-1 font-mono text-[11px] text-slate-500">{role.key}</div><div className="mt-1 max-w-[220px] text-xs text-slate-500">{role.description ?? 'ไม่มีคำอธิบาย'}</div></td><td className="px-4 py-3"><div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"><UserRound className="h-3.5 w-3.5 text-primary-600" />{role.owner?.full_name ?? 'ยังไม่กำหนด'}</div><div className="mt-1 max-w-[220px] text-xs text-slate-500">{role.scope ?? 'ไม่ระบุ Scope'}</div></td><td className="px-4 py-3"><Badge variant="info">{reviewFrequencyLabels[role.review_frequency] ?? role.review_frequency}</Badge>{role.sensitive_role && <Badge variant="warning"><ShieldAlert className="h-3 w-3" />Sensitive</Badge>}</td><td className="px-4 py-3"><button type="button" onClick={() => { setSelectedRole(role); setModal('versions'); }} className="inline-flex items-center gap-1 font-mono text-xs font-bold text-primary-700 hover:underline dark:text-primary-300" aria-label={`ดูประวัติเวอร์ชัน ${role.name_th}`}><History className="h-3.5 w-3.5" />v{role.version ?? 1}</button></td><td className="px-4 py-3"><span className="font-mono font-bold">{role.assigned_user_count ?? 0}</span><div className="text-[11px] text-slate-500">คน</div></td><td className="px-4 py-3">{(role.sod_conflict_count ?? 0) > 0 ? <span title={(role.sod_conflicts ?? []).map((conflict) => conflict.label).join(', ')}><Badge variant="danger"><AlertTriangle className="h-3 w-3" />{role.sod_conflict_count} รายการ</Badge></span> : <Badge variant="success"><CheckCircle2 className="h-3 w-3" />ไม่พบ</Badge>}</td><td className="px-4 py-3">{role.is_system ? <Badge variant="secondary"><LockKeyhole className="h-3 w-3" />System Lock</Badge> : <Badge variant="neutral">Custom</Badge>}</td><td className="px-4 py-3 text-right"><RowActions recordLabel={role.name_th} actions={[{ kind: 'view', to: '/admin/permission-matrix', label: 'ดูสิทธิ์' }, { kind: 'edit', permission: 'role.manage', hidden: role.is_system, onClick: () => openEditor('edit', role) }, { kind: 'custom', icon: Copy, label: 'Clone', permission: 'role.manage', onClick: () => openEditor('clone', role) }, { kind: 'custom', icon: History, label: 'Versions', onClick: () => { setSelectedRole(role); setModal('versions'); } }, { kind: 'delete', permission: 'role.manage', hidden: role.is_system, disabled: (role.assigned_user_count ?? 0) > 0, label: (role.assigned_user_count ?? 0) > 0 ? 'ลบไม่ได้' : 'ลบ', deleteEndpoint: `/api/v1/record-deletions/roles/${role.id}` }]} /></td></tr>)}
    </tbody></table></div></CardBody></Card>}
    {modal === 'create' && ownersQuery.data && <FormModal title="เพิ่มบทบาท" description="สร้าง Custom Role พร้อม metadata การกำกับดูแล" size="lg" onClose={closeModal}><RoleEditor owners={ownersQuery.data} onClose={closeModal} /></FormModal>}
    {modal === 'edit' && selectedRole && ownersQuery.data && <FormModal title={`แก้ไขบทบาท — ${selectedRole.name_th}`} description="การบันทึกจะสร้าง Role Version ใหม่อัตโนมัติ" size="lg" onClose={closeModal}><RoleEditor role={selectedRole} owners={ownersQuery.data} onClose={closeModal} /></FormModal>}
    {modal === 'clone' && selectedRole && ownersQuery.data && <FormModal title={`คัดลอกบทบาท — ${selectedRole.name_th}`} description="Permission Matrix จะถูกคัดลอกไปยัง Custom Role ใหม่" size="lg" onClose={closeModal}><RoleEditor cloneFrom={selectedRole} owners={ownersQuery.data} onClose={closeModal} /></FormModal>}
    {modal === 'versions' && selectedRole && <RoleVersionModal role={selectedRole} onClose={closeModal} />}
    {canManage && ownersQuery.isLoading && modal && modal !== 'versions' && <div className="sr-only" role="status">กำลังโหลดรายชื่อ Role Owner</div>}
  </div>;
}

function StatCardLike({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: 'primary' | 'teal' | 'amber' | 'danger' | 'gray' }) {
  const toneClasses = { primary: 'border-b-primary-500', teal: 'border-b-teal-600', amber: 'border-b-amber-500', danger: 'border-b-red-500', gray: 'border-b-slate-400' };
  const iconClasses = { primary: 'bg-primary-600', teal: 'bg-teal-700', amber: 'bg-amber-600', danger: 'bg-red-600', gray: 'bg-slate-500' };
  return <Card className={`flex min-h-[104px] items-center gap-3 border-b-2 p-4 ${toneClasses[tone]}`}><div className={`flex h-11 w-11 items-center justify-center rounded-xl text-white ${iconClasses[tone]}`}>{icon}</div><div><p className="font-mono text-[22px] font-bold leading-tight text-slate-900 dark:text-white">{value}</p><p className="text-xs text-slate-500 dark:text-slate-400">{label}</p></div></Card>;
}
