import { DataTable } from '../../components/table/DataTable';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Layers3, Loader2, MinusCircle, ShieldCheck, XCircle } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Permission, Role, RolePermissionEntry } from '../../types/admin';
import { StatCard } from '../../components/ui/Card';
import { PageTitle } from '../../components/ui/PageTitle';

type Effect = 'allow' | 'deny' | 'none';

function nextEffect(current: Effect): Effect {
  if (current === 'none') return 'allow';
  if (current === 'allow') return 'deny';
  return 'none';
}

function EffectCell({ effect, disabled, onToggle }: { effect: Effect; disabled: boolean; onToggle: () => void }) {
  const icon =
    effect === 'allow' ? (
      <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
    ) : effect === 'deny' ? (
      <XCircle className="h-5 w-5 text-red-600" aria-hidden="true" />
    ) : (
      <MinusCircle className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden="true" />
    );

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center justify-center py-2 disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={`สิทธิ์: ${effect}`}
      title={effect === 'allow' ? 'อนุญาต' : effect === 'deny' ? 'ปฏิเสธ' : 'ไม่ได้กำหนด'}
    >
      {icon}
    </button>
  );
}

export function PermissionMatrixPage() {
  const queryClient = useQueryClient();
  const [pendingByRole, setPendingByRole] = useState<Record<string, Record<string, Effect>>>({});
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rolesQuery = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => apiFetch<Role[]>('/api/v1/roles') });
  const permissionsQuery = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: () => apiFetch<Permission[]>('/api/v1/permissions'),
  });

  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const permissions = useMemo(() => permissionsQuery.data ?? [], [permissionsQuery.data]);

  const rolePermissionQueries = useQueries({
    queries: roles.map((role) => ({
      queryKey: ['admin', 'roles', role.id, 'permissions'],
      queryFn: () => apiFetch<RolePermissionEntry[]>(`/api/v1/roles/${role.id}/permissions`),
      enabled: roles.length > 0,
    })),
  });

  const isLoading = rolesQuery.isLoading || permissionsQuery.isLoading || rolePermissionQueries.some((q) => q.isLoading);

  const savedMatrix: Record<string, Record<string, Effect>> = {};
  roles.forEach((role, index) => {
    const entries = rolePermissionQueries[index]?.data ?? [];
    savedMatrix[role.id] = {};
    entries.forEach((entry) => {
      savedMatrix[role.id][entry.permission_id] = entry.effect;
    });
  });

  function getEffect(roleId: string, permissionId: string): Effect {
    return pendingByRole[roleId]?.[permissionId] ?? savedMatrix[roleId]?.[permissionId] ?? 'none';
  }

  function toggleCell(roleId: string, permissionId: string) {
    const current = getEffect(roleId, permissionId);
    setPendingByRole((prev) => ({
      ...prev,
      [roleId]: { ...prev[roleId], [permissionId]: nextEffect(current) },
    }));
  }

  const saveMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const merged: Record<string, Effect> = { ...savedMatrix[roleId], ...pendingByRole[roleId] };
      const permissionsPayload = Object.entries(merged)
        .filter(([, effect]) => effect !== 'none')
        .map(([permissionId, effect]) => ({ permissionId, effect: effect as 'allow' | 'deny' }));

      return apiFetch(`/api/v1/roles/${roleId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: permissionsPayload }),
      });
    },
    onMutate: (roleId) => {
      setSavingRoleId(roleId);
      setSaveError(null);
    },
    onSuccess: (_data, roleId) => {
      setPendingByRole((prev) => {
        const next = { ...prev };
        delete next[roleId];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'roles', roleId, 'permissions'] });
    },
    onError: (error) => setSaveError(error instanceof ApiError ? error.message : 'บันทึกไม่สำเร็จ'),
    onSettled: () => setSavingRoleId(null),
  });

  const permissionsByModule = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const permission of permissions) {
      const list = groups.get(permission.module_key) ?? [];
      list.push(permission);
      groups.set(permission.module_key, list);
    }
    return groups;
  }, [permissions]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4"><PageTitle eyebrow="บุคลากรและสิทธิ์ / Permission Matrix" title="Permission Matrix" description="คลิกที่ช่องเพื่อสลับ ไม่ได้กำหนด → อนุญาต → ปฏิเสธ → ไม่ได้กำหนด แล้วกดบันทึกในคอลัมน์ของบทบาทนั้น (บทบาท super_admin มีสิทธิ์เต็มเสมอโดยออกแบบ แก้ไขไม่ได้)" /></div>

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="บทบาท" value={roles.length} tone="primary" />
        <StatCard icon={<KeyRound className="h-5 w-5" />} label="สิทธิ์ทั้งหมด" value={permissions.length} tone="teal" />
        <StatCard icon={<Layers3 className="h-5 w-5" />} label="โมดูลสิทธิ์" value={permissionsByModule.size} tone="amber" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="บทบาทระบบ" value={roles.filter((role) => role.is_system).length} tone="gray" />
      </div>

      {saveError && <p className="mb-3 text-sm text-red-600">{saveError}</p>}

      <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
        <DataTable rowNumber={false} className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800">
              <th className="sticky left-0 bg-slate-50 px-4 py-2 text-left text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                สิทธิ์
              </th>
              {roles.map((role) => {
                const isDirty = Object.keys(pendingByRole[role.id] ?? {}).length > 0;
                return (
                  <th key={role.id} className="min-w-[110px] px-2 py-2 text-center text-xs text-slate-600 dark:text-slate-300">
                    <div>{role.name_th}</div>
                    {role.key !== 'super_admin' && (
                      <button
                        type="button"
                        disabled={!isDirty || savingRoleId === role.id}
                        onClick={() => saveMutation.mutate(role.id)}
                        className="mt-1 rounded bg-primary-600 px-2 py-0.5 text-[11px] font-normal text-white disabled:opacity-30"
                      >
                        {savingRoleId === role.id ? 'กำลังบันทึก...' : 'บันทึก'}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {[...permissionsByModule.entries()].map(([moduleKey, modulePermissions]) => (
              <Fragment key={moduleKey}>
                <tr className="bg-slate-100 dark:bg-slate-900">
                  <td colSpan={roles.length + 1} className="px-4 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {moduleKey}
                  </td>
                </tr>
                {modulePermissions.map((permission) => (
                  <tr key={permission.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="sticky left-0 bg-white px-4 py-1 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      <span className="font-mono text-xs">{permission.key}</span>
                      {permission.description && (
                        <span className="ml-2 text-xs text-slate-400">— {permission.description}</span>
                      )}
                    </td>
                    {roles.map((role) => (
                      <td key={role.id} className="border-l border-slate-100 dark:border-slate-800">
                        <EffectCell
                          effect={getEffect(role.id, permission.id)}
                          disabled={role.key === 'super_admin'}
                          onToggle={() => toggleCell(role.id, permission.id)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </DataTable>
      </div>
    </div>
  );
}
