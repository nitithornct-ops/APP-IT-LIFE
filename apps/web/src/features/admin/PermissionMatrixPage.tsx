import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CheckSquare,
  ClipboardCheck,
  Download,
  Eye,
  GitCompareArrows,
  KeyRound,
  Layers3,
  Loader2,
  MinusCircle,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, StatCard } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type {
  EffectivePermission,
  Permission,
  Role,
  RolePermissionChangeRequest,
  RolePermissionEntry,
  UserOption,
} from '../../types/admin';
import { downloadCsv } from '../../utils/csv';

type Effect = 'allow' | 'deny' | 'none';

const effectLabels: Record<Effect, string> = {
  allow: 'อนุญาต',
  deny: 'ปฏิเสธ',
  none: 'ไม่ได้กำหนด',
};

function nextEffect(current: Effect): Effect {
  if (current === 'none') return 'allow';
  if (current === 'allow') return 'deny';
  return 'none';
}

function EffectPill({ effect }: { effect: Effect }) {
  if (effect === 'allow') return <Badge variant="success"><CheckCircle2 className="h-3 w-3" />ALLOW</Badge>;
  if (effect === 'deny') return <Badge variant="danger"><XCircle className="h-3 w-3" />DENY</Badge>;
  return <Badge variant="neutral"><MinusCircle className="h-3 w-3" />NONE</Badge>;
}

function EffectCell({ effect, disabled, sensitive, onToggle }: { effect: Effect; disabled: boolean; sensitive: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`flex min-h-10 w-full items-center justify-center px-2 py-2 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-primary-900/30 ${sensitive ? 'bg-rose-50/40 dark:bg-rose-950/10' : ''}`}
      aria-label={`สิทธิ์: ${effectLabels[effect]}`}
      title={disabled ? 'บทบาทระบบหรือผู้ใช้ไม่มีสิทธิ์แก้ไข' : `${effectLabels[effect]} — คลิกเพื่อเปลี่ยน`}
    >
      {effect === 'allow' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" /> : effect === 'deny' ? <XCircle className="h-5 w-5 text-red-600" aria-hidden="true" /> : <MinusCircle className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden="true" />}
    </button>
  );
}

function permissionSourceLabel(source: EffectivePermission['source']): string {
  if (source === 'role') return 'Role';
  if (source === 'override') return 'Override';
  if (source === 'group') return 'Group';
  return 'No grant';
}

function EffectivePermissionModal({ user, onClose }: { user: UserOption; onClose: () => void }) {
  const effectiveQuery = useQuery({
    queryKey: ['admin', 'users', user.id, 'effective-permissions'],
    queryFn: () => apiFetch<EffectivePermission[]>(`/api/v1/users/${user.id}/effective-permissions`),
  });
  const permissions = effectiveQuery.data ?? [];
  const allowedCount = permissions.filter((permission) => permission.effective_effect === 'allow').length;
  const sensitiveCount = permissions.filter((permission) => permission.is_privileged && permission.effective_effect === 'allow').length;

  return (
    <Modal
      title={`ลองดูในฐานะ ${user.full_name}`}
      description={`${user.username ?? user.email} · Effective Permission ที่ระบบจะใช้จริง`}
      icon={<Eye className="h-5 w-5" />}
      size="lg"
      onClose={onClose}
      contentPadding="compact"
    >
      {effectiveQuery.isLoading && <div className="flex justify-center py-10" role="status"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {effectiveQuery.isError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">โหลด Effective Permission ไม่สำเร็จ</p>}
      {effectiveQuery.data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60"><p className="text-[11px] text-slate-500">สิทธิ์ที่อนุญาต</p><p className="mt-1 text-xl font-bold text-emerald-700">{allowedCount}</p></div>
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900/60 dark:bg-rose-950/20"><p className="text-[11px] text-rose-700 dark:text-rose-300">Sensitive ที่มีผล</p><p className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-200">{sensitiveCount}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60"><p className="text-[11px] text-slate-500">สิทธิ์ทั้งหมด</p><p className="mt-1 text-xl font-bold text-slate-700 dark:text-slate-200">{permissions.length}</p></div>
          </div>
          <div className="max-h-[52dvh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400"><tr><th className="px-3 py-2">Permission</th><th className="px-3 py-2">ผลลัพธ์</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">หมดอายุ</th></tr></thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={permission.permission_id} className={`border-t border-slate-100 dark:border-slate-800 ${permission.is_privileged ? 'bg-rose-50/50 dark:bg-rose-950/10' : ''}`}>
                    <td className="px-3 py-2"><div className="flex items-center gap-1.5"><span className="font-mono text-slate-700 dark:text-slate-200">{permission.permission_key}</span>{permission.is_privileged && <Badge variant="danger"><ShieldAlert className="h-3 w-3" />Sensitive</Badge>}</div><p className="mt-0.5 text-slate-400">{permission.description ?? '—'}</p></td>
                    <td className="px-3 py-2"><EffectPill effect={permission.effective_effect} /></td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{(permission.sources.length ? permission.sources : [{ type: permission.source, id: '', name: permissionSourceLabel(permission.source), effect: permission.effective_effect, startsAt: null, endsAt: null, temporary: false, approvalStatus: 'approved', reason: null }]).map((source, index) => <Badge key={`${source.type}-${source.id}-${index}`} variant={source.type === 'override' ? 'warning' : source.type === 'group' ? 'info' : 'secondary'}>{permissionSourceLabel(source.type)}{source.name ? `: ${source.name}` : ''}</Badge>)}</div></td>
                    <td className="px-3 py-2 text-slate-500">{permission.expires_at ? new Date(permission.expires_at).toLocaleDateString('th-TH') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ChangeSummaryModal({
  role,
  changes,
  userOptions,
  approvalNeeded,
  isPending,
  error,
  onClose,
  onSave,
  onRequestApproval,
}: {
  role: Role;
  changes: Array<{ permission: Permission; from: Effect; to: Effect }>;
  userOptions: UserOption[];
  approvalNeeded: boolean;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
  onRequestApproval: (approverId: string, reason: string) => void;
}) {
  const [approverId, setApproverId] = useState('');
  const [reason, setReason] = useState('');
  const privilegedChanges = changes.filter((change) => change.permission.is_privileged);

  return (
    <Modal
      title="ตรวจสอบการเปลี่ยนแปลงก่อนบันทึก"
      description={`Role ${role.name_th} · ${changes.length} รายการ`}
      icon={approvalNeeded ? <ShieldAlert className="h-5 w-5 text-rose-600" /> : <ClipboardCheck className="h-5 w-5" />}
      size="lg"
      closeOnBackdrop={false}
      closeDisabled={isPending}
      onClose={onClose}
      contentPadding="compact"
      footer={
        <>
          <Button type="button" variant="outline" disabled={isPending} onClick={onClose}>กลับไปแก้ไข</Button>
          {approvalNeeded ? <Button type="button" variant="danger" isLoading={isPending} disabled={!approverId || !reason.trim()} onClick={() => onRequestApproval(approverId, reason.trim())}><ClipboardCheck className="h-4 w-4" />ส่งคำขออนุมัติ</Button> : <Button type="button" isLoading={isPending} onClick={onSave}><Save className="h-4 w-4" />ยืนยันบันทึก</Button>}
        </>
      }
    >
      <div className="space-y-4">
        {approvalNeeded && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-100" role="alert">
            <p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" />การเปลี่ยนแปลงนี้ต้องมีผู้อนุมัติแยกหน้าที่</p>
            <p className="mt-1">Role <strong>{role.name_th}</strong> กำลังได้รับ/เปลี่ยนสิทธิ์ระดับสูง กรุณาเลือกผู้อนุมัติที่ไม่ใช่ผู้ทำรายการ ระบบจะยังไม่แก้สิทธิ์จนกว่าจะอนุมัติ</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold">ผู้อนุมัติ
                <select value={approverId} onChange={(event) => setApproverId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-rose-300 bg-white px-3 text-sm text-slate-800 dark:border-rose-800 dark:bg-slate-900 dark:text-slate-100">
                  <option value="">— เลือกผู้อนุมัติ —</option>
                  {userOptions.map((user) => <option key={user.id} value={user.id}>{user.full_name} · {user.username ?? user.email}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold">เหตุผลที่ต้องเปลี่ยน
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={1500} placeholder="เช่น เพิ่มสิทธิ์เพื่อรองรับหน้าที่ Service Desk" className="mt-1 w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-rose-800 dark:bg-slate-900 dark:text-slate-100" />
              </label>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900/60"><span className="font-semibold text-slate-700 dark:text-slate-200">รายการที่จะเปลี่ยน</span><span className="text-slate-500">{privilegedChanges.length ? `${privilegedChanges.length} Sensitive` : 'ไม่มี Sensitive'}</span></div>
          <div className="max-h-72 overflow-auto">
            {changes.map(({ permission, from, to }) => <div key={permission.id} className={`grid grid-cols-[minmax(0,1fr)_auto_20px_auto] items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 dark:border-slate-800 ${permission.is_privileged ? 'bg-rose-50/60 dark:bg-rose-950/15' : ''}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{permission.key}</span>{permission.is_privileged && <Badge variant="danger">Sensitive</Badge>}</div><p className="truncate text-slate-400">{permission.description ?? permission.module_key}</p></div><EffectPill effect={from} /><span className="text-slate-400">→</span><EffectPill effect={to} /></div>)}
          </div>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

function ApprovalQueue({ requests, actorId, onDecided }: { requests: RolePermissionChangeRequest[]; actorId: string | undefined; onDecided: () => void }) {
  const decisionMutation = useMutation({
    mutationFn: ({ request, decision }: { request: RolePermissionChangeRequest; decision: 'approve' | 'reject' }) => apiFetch(`/api/v1/roles/${request.role_id}/permission-change-requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ decision }) }),
    onSuccess: onDecided,
  });
  const pending = requests.filter((request) => request.status === 'pending');
  return (
    <Card className="mb-4 border-amber-200 dark:border-amber-900/60" data-testid="permission-approval-queue">
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><ClipboardCheck className="h-4 w-4 text-amber-600" /> Approval queue</p><p className="mt-0.5 text-xs text-slate-500">คำขอเปลี่ยน Permission ระดับสูงต้องได้รับการอนุมัติก่อนมีผล</p></div><Badge variant={pending.length ? 'warning' : 'success'}>{pending.length} รอดำเนินการ</Badge></div>
        {pending.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-900/60">ไม่มีคำขอที่รออนุมัติ</p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">{pending.map((request) => { const canApprove = request.approver_id === actorId && request.requested_by !== actorId; return <div key={request.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-800 dark:text-slate-100">{request.role?.name_th ?? request.role_id}</p><p className="mt-0.5 text-xs text-slate-500">ขอโดย {request.requester?.full_name ?? request.requested_by} · อนุมัติโดย {request.approver?.full_name ?? request.approver_id}</p></div><Badge variant="warning">pending</Badge></div><p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{request.reason}</p><div className="mt-2 flex flex-wrap gap-1">{request.changes.map((change) => <Badge key={change.permission_id} variant="danger"><ShieldAlert className="h-3 w-3" />{change.permission_key}: {change.from} → {change.to}</Badge>)}</div>{canApprove ? <div className="mt-3 flex gap-2"><Button size="sm" variant="success" isLoading={decisionMutation.isPending && decisionMutation.variables?.request.id === request.id && decisionMutation.variables.decision === 'approve'} onClick={() => decisionMutation.mutate({ request, decision: 'approve' })}><Check className="h-3.5 w-3.5" />อนุมัติ</Button><Button size="sm" variant="danger" isLoading={decisionMutation.isPending && decisionMutation.variables?.request.id === request.id && decisionMutation.variables.decision === 'reject'} onClick={() => decisionMutation.mutate({ request, decision: 'reject' })}><XCircle className="h-3.5 w-3.5" />ปฏิเสธ</Button></div> : <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">รอผู้อนุมัติที่ถูกระบุ · ผู้ขออนุมัติตัวเองไม่ได้</p>}</div>; })}</div>}
      </CardBody>
    </Card>
  );
}

export function PermissionMatrixPage() {
  const queryClient = useQueryClient();
  const { hasPermission, me } = useAuth();
  const canManage = hasPermission('role.manage');
  const [pendingByRole, setPendingByRole] = useState<Record<string, Record<string, Effect>>>({});
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);
  const [bulkRoleId, setBulkRoleId] = useState('');
  const [bulkEffect, setBulkEffect] = useState<Effect>('allow');
  const [showCompare, setShowCompare] = useState(false);
  const [compareAId, setCompareAId] = useState('');
  const [compareBId, setCompareBId] = useState('');
  const [compareOnlyDiff, setCompareOnlyDiff] = useState(true);
  const [previewUserId, setPreviewUserId] = useState('');
  const [showEffectivePreview, setShowEffectivePreview] = useState(false);
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);
  const [summaryRoleId, setSummaryRoleId] = useState<string | null>(null);

  const rolesQuery = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => apiFetch<Role[]>('/api/v1/roles') });
  const permissionsQuery = useQuery({ queryKey: ['admin', 'permissions'], queryFn: () => apiFetch<Permission[]>('/api/v1/permissions') });
  const usersQuery = useQuery({ queryKey: ['admin', 'user-options'], queryFn: () => apiFetch<UserOption[]>('/api/v1/users/options') });
  const requestsQuery = useQuery({ queryKey: ['admin', 'role-permission-change-requests'], queryFn: () => apiFetch<RolePermissionChangeRequest[]>('/api/v1/roles/permission-change-requests'), enabled: canManage });

  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const permissions = useMemo(() => permissionsQuery.data ?? [], [permissionsQuery.data]);
  const userOptions = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const rolePermissionQueries = useQueries({ queries: roles.map((role) => ({ queryKey: ['admin', 'roles', role.id, 'permissions'], queryFn: () => apiFetch<RolePermissionEntry[]>(`/api/v1/roles/${role.id}/permissions`), enabled: roles.length > 0 })) });
  const isLoading = rolesQuery.isLoading || permissionsQuery.isLoading || rolePermissionQueries.some((query) => query.isLoading);
  const isError = rolesQuery.isError || permissionsQuery.isError || rolePermissionQueries.some((query) => query.isError);

  const savedMatrix = useMemo(() => {
    const matrix: Record<string, Record<string, Effect>> = {};
    roles.forEach((role, index) => {
      matrix[role.id] = {};
      for (const entry of rolePermissionQueries[index]?.data ?? []) matrix[role.id][entry.permission_id] = entry.effect;
    });
    return matrix;
  }, [rolePermissionQueries, roles]);

  const getEffect = useCallback((roleId: string, permissionId: string): Effect => pendingByRole[roleId]?.[permissionId] ?? savedMatrix[roleId]?.[permissionId] ?? 'none', [pendingByRole, savedMatrix]);
  const hasPendingChange = (roleId: string, permissionId: string): boolean => Object.prototype.hasOwnProperty.call(pendingByRole[roleId] ?? {}, permissionId);
  const changedPermissionSet = useMemo(() => new Set(Object.values(pendingByRole).flatMap((changes) => Object.keys(changes))), [pendingByRole]);
  const permissionsByModule = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const permission of permissions) {
      if (sensitiveOnly && !permission.is_privileged) continue;
      if (search && !`${permission.key} ${permission.description ?? ''} ${permission.module_key}`.toLocaleLowerCase('th-TH').includes(search.toLocaleLowerCase('th-TH'))) continue;
      if (changedOnly && !changedPermissionSet.has(permission.id)) continue;
      const list = groups.get(permission.module_key) ?? [];
      list.push(permission);
      groups.set(permission.module_key, list);
    }
    return groups;
  }, [changedOnly, changedPermissionSet, permissions, search, sensitiveOnly]);
  const visiblePermissions = useMemo(() => [...permissionsByModule.values()].flat(), [permissionsByModule]);
  const editableRoles = useMemo(() => roles.filter((role) => !role.is_system), [roles]);
  const selectedBulkRoleId = bulkRoleId || editableRoles[0]?.id || '';
  const compareRoleA = roles.find((role) => role.id === (compareAId || roles[0]?.id)) ?? roles[0];
  const compareRoleB = roles.find((role) => role.id === (compareBId || roles.find((role) => role.id !== compareRoleA?.id)?.id)) ?? roles.find((role) => role.id !== compareRoleA?.id) ?? compareRoleA;
  const compareRows = useMemo(() => permissions.filter((permission) => !compareOnlyDiff || (compareRoleA && compareRoleB && getEffect(compareRoleA.id, permission.id) !== getEffect(compareRoleB.id, permission.id))), [compareOnlyDiff, compareRoleA, compareRoleB, getEffect, permissions]);
  const summaryRole = roles.find((role) => role.id === summaryRoleId) ?? null;
  const summaryChanges = useMemo(() => {
    if (!summaryRoleId) return [];
    return Object.keys(pendingByRole[summaryRoleId] ?? {}).map((permissionId) => {
      const permission = permissions.find((item) => item.id === permissionId);
      return permission ? { permission, from: savedMatrix[summaryRoleId]?.[permissionId] ?? 'none' as Effect, to: getEffect(summaryRoleId, permissionId) } : null;
    }).filter((change): change is { permission: Permission; from: Effect; to: Effect } => Boolean(change));
  }, [getEffect, pendingByRole, permissions, savedMatrix, summaryRoleId]);
  const criticalPendingChanges = useMemo(() => roles.flatMap((role) => Object.keys(pendingByRole[role.id] ?? {}).flatMap((permissionId) => {
    const permission = permissions.find((item) => item.id === permissionId);
    if (!permission?.is_privileged) return [];
    const from = savedMatrix[role.id]?.[permissionId] ?? 'none';
    const to = getEffect(role.id, permissionId);
    return from === to ? [] : [{ role, permission, from, to }];
  })), [getEffect, pendingByRole, permissions, roles, savedMatrix]);
  const approvalNeeded = summaryChanges.some((change) => change.permission.is_privileged && change.from !== change.to);
  const previewUser = userOptions.find((user) => user.id === previewUserId) ?? null;

  function setPendingEffect(roleId: string, permissionId: string, effect: Effect) {
    if (!canManage || roles.find((role) => role.id === roleId)?.is_system) return;
    const saved = savedMatrix[roleId]?.[permissionId] ?? 'none';
    setPendingByRole((current) => {
      const roleChanges = { ...(current[roleId] ?? {}) };
      if (effect === saved) delete roleChanges[permissionId];
      else roleChanges[permissionId] = effect;
      const next = { ...current };
      if (Object.keys(roleChanges).length) next[roleId] = roleChanges;
      else delete next[roleId];
      return next;
    });
  }

  function toggleCell(roleId: string, permissionId: string) {
    setPendingEffect(roleId, permissionId, nextEffect(getEffect(roleId, permissionId)));
  }

  function toggleVisibleSelection() {
    const visibleIds = visiblePermissions.map((permission) => permission.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedPermissionIds.includes(id));
    setSelectedPermissionIds((current) => allSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
  }

  function applyBulkChange() {
    if (!selectedBulkRoleId || !canManage) return;
    for (const permissionId of selectedPermissionIds) setPendingEffect(selectedBulkRoleId, permissionId, bulkEffect);
  }

  function mergeRolePermissions(roleId: string) {
    const merged = { ...(savedMatrix[roleId] ?? {}), ...(pendingByRole[roleId] ?? {}) };
    return Object.entries(merged).filter(([, effect]) => effect !== 'none').map(([permissionId, effect]) => ({ permissionId, effect: effect as 'allow' | 'deny' }));
  }

  const saveMutation = useMutation({
    mutationFn: (roleId: string) => apiFetch(`/api/v1/roles/${roleId}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions: mergeRolePermissions(roleId) }) }),
    onMutate: (roleId) => { setSavingRoleId(roleId); setSaveError(null); },
    onSuccess: (_data, roleId) => { setPendingByRole((current) => { const next = { ...current }; delete next[roleId]; return next; }); setSummaryRoleId(null); void queryClient.invalidateQueries({ queryKey: ['admin', 'roles', roleId, 'permissions'] }); void queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] }); },
    onError: (error) => setSaveError(error instanceof ApiError ? error.message : 'บันทึกไม่สำเร็จ'),
    onSettled: () => setSavingRoleId(null),
  });
  const approvalMutation = useMutation({
    mutationFn: ({ roleId, approverId, reason }: { roleId: string; approverId: string; reason: string }) => apiFetch(`/api/v1/roles/${roleId}/permission-change-requests`, { method: 'POST', body: JSON.stringify({ permissions: mergeRolePermissions(roleId), changes: summaryChanges.map((change) => ({ permissionId: change.permission.id, permissionKey: change.permission.key, from: change.from, to: change.to, isPrivileged: change.permission.is_privileged })), approverId, reason }) }),
    onMutate: (variables) => { setSavingRoleId(variables.roleId); setSaveError(null); },
    onSuccess: (_data, variables) => { setPendingByRole((current) => { const next = { ...current }; delete next[variables.roleId]; return next; }); setSummaryRoleId(null); void queryClient.invalidateQueries({ queryKey: ['admin', 'role-permission-change-requests'] }); },
    onError: (error) => setSaveError(error instanceof ApiError ? error.message : 'ส่งคำขออนุมัติไม่สำเร็จ'),
    onSettled: () => setSavingRoleId(null),
  });

  function exportMatrix() {
    downloadCsv([
      ['Module', 'Permission', 'Description', 'Sensitive', ...roles.map((role) => role.name_th)],
      ...permissions.map((permission) => [permission.module_key, permission.key, permission.description ?? '', permission.is_privileged ? 'YES' : 'NO', ...roles.map((role) => effectLabels[getEffect(role.id, permission.id)])]),
    ], 'permission-matrix.csv');
  }

  if (isLoading) return <div className="flex justify-center py-10" role="status"><Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" /></div>;
  if (isError) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300" role="alert">โหลด Permission Matrix ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</div>;

  return (
    <div data-testid="permission-matrix-page">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><PageTitle eyebrow="บุคลากรและสิทธิ์ / Permission Matrix" title="Permission Matrix" description="แก้ไขสิทธิ์เป็น draft แล้วตรวจสอบ Change Summary ก่อนบันทึก · สิทธิ์ระดับสูงต้องผ่าน Approval" /><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={exportMatrix}><Download className="h-4 w-4" />Export Matrix</Button>{canManage && <Button size="sm" variant={showApprovalQueue ? 'primary' : 'outline'} onClick={() => setShowApprovalQueue((current) => !current)}><ClipboardCheck className="h-4 w-4" />Approval queue{(requestsQuery.data ?? []).filter((request) => request.status === 'pending').length > 0 && <Badge variant="warning">{(requestsQuery.data ?? []).filter((request) => request.status === 'pending').length}</Badge>}</Button>}</div></div>

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5"><StatCard icon={<ShieldCheck className="h-5 w-5" />} label="บทบาท" value={roles.length} tone="primary" /><StatCard icon={<KeyRound className="h-5 w-5" />} label="สิทธิ์ทั้งหมด" value={permissions.length} tone="teal" /><StatCard icon={<Layers3 className="h-5 w-5" />} label="โมดูลสิทธิ์" value={new Set(permissions.map((permission) => permission.module_key)).size} tone="amber" /><StatCard icon={<ShieldAlert className="h-5 w-5" />} label="Sensitive Permission" value={permissions.filter((permission) => permission.is_privileged).length} tone="danger" /><StatCard icon={<Users className="h-5 w-5" />} label="บทบาทระบบ" value={roles.filter((role) => role.is_system).length} tone="gray" /></div>

      {showApprovalQueue && <ApprovalQueue requests={requestsQuery.data ?? []} actorId={me?.profile.id} onDecided={() => { void queryClient.invalidateQueries({ queryKey: ['admin', 'role-permission-change-requests'] }); void queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] }); }} />}

      <Card className="mb-4"><CardBody>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            <label className="relative min-w-64 flex-1"><span className="sr-only">ค้นหา Permission</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา Permission, module หรือคำอธิบาย..." className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /></label>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300"><input type="checkbox" checked={sensitiveOnly} onChange={(event) => setSensitiveOnly(event.target.checked)} className="rounded border-slate-300 text-primary-600" />เฉพาะ Sensitive</label>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300"><input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} className="rounded border-slate-300 text-primary-600" />เฉพาะที่แก้ไข</label>
          </div>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant={showCompare ? 'primary' : 'outline'} onClick={() => setShowCompare((current) => !current)}><GitCompareArrows className="h-4 w-4" />Compare Role</Button><select aria-label="เลือก User สำหรับ Preview" value={previewUserId} onChange={(event) => { setPreviewUserId(event.target.value); setShowEffectivePreview(false); }} className="h-9 max-w-56 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"><option value="">— เลือก User เพื่อ Preview —</option>{userOptions.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select><Button size="sm" variant="outline" disabled={!previewUser} onClick={() => setShowEffectivePreview(true)}><Eye className="h-4 w-4" />ลองดูในฐานะ User นี้</Button></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary-100 bg-primary-50/60 p-3 dark:border-primary-900/50 dark:bg-primary-950/20"><CheckSquare className="h-4 w-4 text-primary-700 dark:text-primary-300" /><span className="text-xs font-semibold text-primary-900 dark:text-primary-100">Bulk Change</span><select aria-label="Role สำหรับ Bulk Change" value={selectedBulkRoleId} onChange={(event) => setBulkRoleId(event.target.value)} disabled={!canManage} className="h-9 rounded-lg border border-primary-200 bg-white px-2 text-xs dark:border-primary-800 dark:bg-slate-900 dark:text-slate-100"><option value="">— เลือก Custom Role —</option>{editableRoles.map((role) => <option key={role.id} value={role.id}>{role.name_th}</option>)}</select><select aria-label="ผลลัพธ์ Bulk Change" value={bulkEffect} onChange={(event) => setBulkEffect(event.target.value as Effect)} disabled={!canManage} className="h-9 rounded-lg border border-primary-200 bg-white px-2 text-xs dark:border-primary-800 dark:bg-slate-900 dark:text-slate-100"><option value="allow">ตั้งเป็น ALLOW</option><option value="deny">ตั้งเป็น DENY</option><option value="none">ล้างค่า</option></select><Button size="sm" disabled={!canManage || !selectedPermissionIds.length || !selectedBulkRoleId} onClick={applyBulkChange}>ใช้กับ {selectedPermissionIds.length} รายการ</Button><span className="ml-auto text-[11px] text-primary-700 dark:text-primary-300">เลือกจาก checkbox ในแถว Permission</span></div>
      </CardBody></Card>

      {showCompare && compareRoleA && compareRoleB && <Card className="mb-4 border-primary-200 dark:border-primary-900/60" data-testid="permission-role-compare"><CardBody><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><GitCompareArrows className="h-4 w-4 text-primary-600" />Compare Role A vs Role B</p><p className="mt-0.5 text-xs text-slate-500">ดูเฉพาะสิทธิ์ที่ต่างกันเพื่อหาความเสี่ยงได้เร็วขึ้น</p></div><label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><input type="checkbox" checked={compareOnlyDiff} onChange={(event) => setCompareOnlyDiff(event.target.checked)} />เฉพาะรายการที่ต่างกัน</label></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Role A<select value={compareRoleA.id} onChange={(event) => setCompareAId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">{roles.map((role) => <option key={role.id} value={role.id}>{role.name_th}</option>)}</select></label><label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Role B<select value={compareRoleB.id} onChange={(event) => setCompareBId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">{roles.map((role) => <option key={role.id} value={role.id}>{role.name_th}</option>)}</select></label></div><div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-lg bg-primary-50 p-3 text-center dark:bg-primary-950/30"><p className="text-[11px] text-slate-500">Role A</p><p className="font-mono text-lg font-bold text-primary-800 dark:text-primary-200">{compareRows.filter((permission) => getEffect(compareRoleA.id, permission.id) === 'allow').length}</p><p className="text-[11px] text-slate-500">ALLOW ในรายการที่แสดง</p></div><div className="rounded-lg bg-violet-50 p-3 text-center dark:bg-violet-950/30"><p className="text-[11px] text-slate-500">Role B</p><p className="font-mono text-lg font-bold text-violet-800 dark:text-violet-200">{compareRows.filter((permission) => getEffect(compareRoleB.id, permission.id) === 'allow').length}</p><p className="text-[11px] text-slate-500">ALLOW ในรายการที่แสดง</p></div></div><div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400"><tr><th className="px-3 py-2">Permission</th><th className="px-3 py-2">{compareRoleA.name_th}</th><th className="px-3 py-2">{compareRoleB.name_th}</th><th className="px-3 py-2">ความต่าง</th></tr></thead><tbody>{compareRows.map((permission) => { const effectA = getEffect(compareRoleA.id, permission.id); const effectB = getEffect(compareRoleB.id, permission.id); const different = effectA !== effectB; return <tr key={permission.id} className={`border-t border-slate-100 dark:border-slate-800 ${different ? 'bg-amber-50/60 dark:bg-amber-950/15' : ''}`}><td className="px-3 py-2"><span className="font-mono">{permission.key}</span>{permission.is_privileged && <Badge variant="danger"><ShieldAlert className="h-3 w-3" />Sensitive</Badge>}</td><td className="px-3 py-2"><EffectPill effect={effectA} /></td><td className="px-3 py-2"><EffectPill effect={effectB} /></td><td className="px-3 py-2">{different ? <Badge variant="warning">ต่างกัน</Badge> : <span className="text-slate-400">เหมือนกัน</span>}</td></tr>; })}</tbody></table>{compareRows.length === 0 && <p className="p-5 text-center text-sm text-slate-500">ไม่พบ Permission ที่ตรงกับตัวกรอง</p>}</div></CardBody></Card>}

      {saveError && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">{saveError}</p>}
      {criticalPendingChanges.length > 0 && <div className="mb-3 flex gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-100" role="alert"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-300" /><div><p className="font-semibold">ตรวจพบการเปลี่ยนแปลง Sensitive Permission</p><ul className="mt-1 list-disc space-y-1 pl-5">{criticalPendingChanges.slice(0, 5).map(({ role, permission, from, to }) => <li key={`${role.id}-${permission.id}`}>Role <strong>{role.name_th}</strong> {to === 'allow' && from !== 'allow' ? 'กำลังได้รับเพิ่ม' : 'กำลังเปลี่ยนแปลง'} <code className="rounded bg-rose-100 px-1 font-mono text-xs dark:bg-rose-900/50">{permission.key}</code> ซึ่งเป็นสิทธิ์ระดับสูง ({effectLabels[from]} → {effectLabels[to]})</li>)}</ul>{criticalPendingChanges.length > 5 && <p className="mt-1 text-xs">และอีก {criticalPendingChanges.length - 5} รายการ</p>}<p className="mt-2 text-xs font-medium">เมื่อกดบันทึก ระบบจะบังคับส่ง Approval ให้ผู้อนุมัติที่เลือก</p></div></div>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><table className="w-full min-w-[850px] border-collapse text-sm"><thead><tr className="bg-slate-50 dark:bg-slate-800"><th className="sticky left-0 z-20 min-w-[300px] bg-slate-50 px-3 py-3 text-left text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400"><label className="flex items-center gap-2"><input type="checkbox" checked={visiblePermissions.length > 0 && visiblePermissions.every((permission) => selectedPermissionIds.includes(permission.id))} onChange={toggleVisibleSelection} aria-label="เลือก Permission ที่แสดงทั้งหมด" className="rounded border-slate-300 text-primary-600" /><span>Permission</span></label></th>{roles.map((role) => { const dirty = Object.keys(pendingByRole[role.id] ?? {}).length > 0; const pendingApproval = (requestsQuery.data ?? []).some((request) => request.role_id === role.id && request.status === 'pending'); return <th key={role.id} className="min-w-[140px] border-l border-slate-200 px-2 py-3 text-center text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"><div className="font-semibold">{role.name_th}</div><div className="mt-1 flex min-h-5 flex-wrap justify-center gap-1">{role.is_system && <Badge variant="secondary">System lock</Badge>}{dirty && <Badge variant="warning">Draft</Badge>}{pendingApproval && <Badge variant="info">รออนุมัติ</Badge>}</div>{canManage && !role.is_system && <Button size="sm" className="mt-2 min-h-8 px-2 text-[11px]" disabled={!dirty || savingRoleId === role.id} isLoading={savingRoleId === role.id} onClick={() => { setSaveError(null); setSummaryRoleId(role.id); }}>ตรวจสอบ / บันทึก</Button>}</th>; })}</tr></thead><tbody>{[...permissionsByModule.entries()].map(([moduleKey, modulePermissions]) => <Fragment key={`module-${moduleKey}`}><tr className="bg-slate-100 dark:bg-slate-900"><td colSpan={roles.length + 1} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{moduleKey}</td></tr>{modulePermissions.map((permission) => <tr key={permission.id} className={`border-t border-slate-100 dark:border-slate-800 ${permission.is_privileged ? 'bg-rose-50/30 dark:bg-rose-950/10' : ''}`}><td className={`sticky left-0 z-10 bg-white px-3 py-2 dark:bg-slate-900 ${permission.is_privileged ? 'border-l-4 border-rose-500' : ''}`}><div className="flex items-start gap-2"><input type="checkbox" checked={selectedPermissionIds.includes(permission.id)} onChange={(event) => setSelectedPermissionIds((current) => event.target.checked ? [...new Set([...current, permission.id])] : current.filter((id) => id !== permission.id))} aria-label={`เลือก ${permission.key}`} className="mt-0.5 rounded border-slate-300 text-primary-600" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{permission.key}</span>{permission.is_privileged && <Badge variant="danger"><ShieldAlert className="h-3 w-3" />Sensitive</Badge>}</div>{permission.description && <p className="mt-0.5 text-xs text-slate-400">{permission.description}</p>}</div></div></td>{roles.map((role) => <td key={role.id} className={`border-l border-slate-100 dark:border-slate-800 ${permission.is_privileged ? 'bg-rose-50/20 dark:bg-rose-950/5' : ''}`}><EffectCell effect={getEffect(role.id, permission.id)} disabled={!canManage || role.is_system} sensitive={permission.is_privileged} onToggle={() => toggleCell(role.id, permission.id)} />{hasPendingChange(role.id, permission.id) && <span className="block text-center text-[10px] font-semibold text-amber-700 dark:text-amber-300">draft</span>}</td>)}</tr>)}</Fragment>)}</tbody></table>{visiblePermissions.length === 0 && <div className="p-10 text-center text-sm text-slate-500">ไม่พบ Permission ที่ตรงกับตัวกรอง</div>}</div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400"><span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-emerald-600" />ALLOW</span><span className="flex items-center gap-1"><XCircle className="h-4 w-4 text-red-600" />DENY</span><span className="flex items-center gap-1"><MinusCircle className="h-4 w-4 text-slate-400" />NONE</span><span className="flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-rose-700 dark:bg-rose-950/20 dark:text-rose-300"><ShieldAlert className="h-3.5 w-3.5" />Sensitive / สิทธิ์ระดับสูง</span><span className="ml-auto">แสดง {visiblePermissions.length} จาก {permissions.length} Permission</span></div>

      {previewUser && showEffectivePreview && <EffectivePermissionModal user={previewUser} onClose={() => setShowEffectivePreview(false)} />}
      {summaryRole && <ChangeSummaryModal key={summaryRole.id} role={summaryRole} changes={summaryChanges} userOptions={userOptions.filter((user) => user.id !== me?.profile.id)} approvalNeeded={approvalNeeded} isPending={savingRoleId === summaryRole.id} error={saveError} onClose={() => setSummaryRoleId(null)} onSave={() => saveMutation.mutate(summaryRole.id)} onRequestApproval={(approverId, reason) => approvalMutation.mutate({ roleId: summaryRole.id, approverId, reason })} />}
    </div>
  );
}
