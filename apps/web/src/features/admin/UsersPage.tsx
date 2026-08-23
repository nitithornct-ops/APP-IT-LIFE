import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { RowActions } from '../../components/table/RowActions';
import { DeleteConfirmModal, FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronUp, Loader2, Plus, ShieldAlert, ShieldCheck, UserMinus, UserPlus, UsersRound, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { RequirePermission } from '../../components/RequirePermission';
import { StatCard } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import type {
  Department,
  PaginatedResult,
  Permission,
  PermissionOverride,
  Position,
  Role,
  UserListItem,
  UserRoleAssignment,
} from '../../types/admin';
import { formatThaiDate } from '../../utils/date';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

const overrideSchema = z.object({
  permissionId: z.string().min(1, 'กรุณาเลือกสิทธิ์'),
  effect: z.enum(['allow', 'deny']),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล'),
  endAt: z.string().optional(),
});

type OverrideForm = z.infer<typeof overrideSchema>;

function UserPermissionOverridesPanel({ userId, allPermissions }: { userId: string; allPermissions: Permission[] }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const queryKey = ['admin', 'users', userId, 'permission-overrides'];

  const overridesQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<PermissionOverride[]>(`/api/v1/permission-overrides?userId=${userId}`),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OverrideForm>({ resolver: zodResolver(overrideSchema), defaultValues: { effect: 'deny' } });

  const createMutation = useMutation({
    mutationFn: (values: OverrideForm) =>
      apiFetch('/api/v1/permission-overrides', {
        method: 'POST',
        body: JSON.stringify({ userId, ...values, endAt: values.endAt || undefined }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      reset();
      setShowCreate(false);
      setServerError(null);
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'บันทึก override ไม่สำเร็จ'),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      apiFetch(`/api/v1/permission-overrides/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          สิทธิ์ยกเว้นรายบุคคล (Permission Override) — มีผลเหนือบทบาทเสมอ
        </p>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1 text-xs text-primary-700 hover:underline dark:text-primary-300"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          เพิ่ม override
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800"
          noValidate
        >
          <div>
            <label htmlFor={`ov-perm-${userId}`} className="mb-1 block text-xs text-slate-600 dark:text-slate-300">
              สิทธิ์
            </label>
            <select
              id={`ov-perm-${userId}`}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('permissionId')}
            >
              <option value="">— เลือกสิทธิ์ —</option>
              {allPermissions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key}
                </option>
              ))}
            </select>
            {errors.permissionId && <p className="mt-1 text-xs text-red-600">{errors.permissionId.message}</p>}
          </div>

          <div>
            <label htmlFor={`ov-effect-${userId}`} className="mb-1 block text-xs text-slate-600 dark:text-slate-300">
              ผล
            </label>
            <select
              id={`ov-effect-${userId}`}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('effect')}
            >
              <option value="deny">DENY (ปิดสิทธิ์)</option>
              <option value="allow">ALLOW (เปิดสิทธิ์เพิ่ม)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor={`ov-reason-${userId}`} className="mb-1 block text-xs text-slate-600 dark:text-slate-300">
              เหตุผล
            </label>
            <input
              id={`ov-reason-${userId}`}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('reason')}
            />
            {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason.message}</p>}
          </div>

          <div>
            <label htmlFor={`ov-end-${userId}`} className="mb-1 block text-xs text-slate-600 dark:text-slate-300">
              สิ้นสุด (ถ้ามี)
            </label>
            <input
              id={`ov-end-${userId}`}
              type="date"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('endAt')}
            />
          </div>

          {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-md bg-primary-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              บันทึก
            </button>
          </div>
        </form>
      )}

      {overridesQuery.data && overridesQuery.data.length === 0 && (
        <p className="text-xs text-slate-400">ยังไม่มี override สำหรับผู้ใช้นี้</p>
      )}

      {overridesQuery.data && overridesQuery.data.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {overridesQuery.data.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <span className="flex items-center gap-2">
                <Badge variant={o.effect === 'deny' ? 'danger' : 'success'}>{o.effect.toUpperCase()}</Badge>
                <span className="font-mono text-slate-700 dark:text-slate-200">{o.permissions?.key}</span>
                <span className="text-slate-400">— {o.reason}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={o.status === 'active' ? 'success' : 'secondary'}>
                  {o.status === 'active' ? 'ใช้งาน' : 'ระงับ'}
                </Badge>
                <button
                  type="button"
                  onClick={() =>
                    toggleStatusMutation.mutate({ id: o.id, status: o.status === 'active' ? 'inactive' : 'active' })
                  }
                  className="text-primary-700 hover:underline dark:text-primary-300"
                >
                  {o.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SupervisorPanel({ user, allUsers }: { user: UserListItem; allUsers: UserListItem[] }) {
  const queryClient = useQueryClient();
  const [supervisorId, setSupervisorId] = useState(user.supervisor_id ?? '');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ supervisorId: supervisorId || null }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setServerError(null);
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'บันทึกหัวหน้างานไม่สำเร็จ'),
  });

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        หัวหน้างาน (Supervisor) — ใช้เป็นเส้นทางอนุมัติของโมดูล "คำขอสิทธิ์ระบบ"
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={supervisorId}
          onChange={(e) => setSupervisorId(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        >
          <option value="">— ไม่ระบุ —</option>
          {allUsers
            .filter((u) => u.id !== user.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-2 rounded-md bg-primary-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 disabled:opacity-60"
        >
          {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          บันทึก
        </button>
        {serverError && <p className="text-xs text-red-600">{serverError}</p>}
      </div>
    </div>
  );
}

const inviteSchema = z.object({
  email: z.string().trim().email('กรุณากรอกอีเมลให้ถูกต้อง'),
  fullName: z.string().trim().min(1, 'กรุณากรอกชื่อ-สกุล'),
  employeeCode: z.string().trim().optional(),
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
});

type InviteForm = z.infer<typeof inviteSchema>;

function StatusBadge({ status }: { status: 'active' | 'inactive' }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        status === 'active'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
      }`}
    >
      {status === 'active' ? 'ใช้งาน' : 'ระงับ'}
    </span>
  );
}

function InviteUserForm({
  departments,
  positions,
  onClose,
}: {
  departments: Department[];
  positions: Position[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteForm>({ resolver: zodResolver(inviteSchema) });

  const mutation = useMutation({
    mutationFn: (values: InviteForm) =>
      apiFetch('/api/v1/users/invite', {
        method: 'POST',
        // <select> ที่ไม่ได้เลือก ("— ไม่ระบุ —") จะส่งค่าเป็น "" เสมอ — ต้องแปลงเป็น undefined
        // ก่อนส่ง มิฉะนั้น backend (z.string().uuid().optional()) จะปฏิเสธด้วย "Invalid uuid"
        body: JSON.stringify({
          ...values,
          departmentId: values.departmentId || undefined,
          positionId: values.positionId || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เชิญผู้ใช้ไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800"
      noValidate
    >
      <div className="sm:col-span-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">เชิญผู้ใช้งานใหม่</h2>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="invite-email" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          อีเมล
        </label>
        <input
          id="invite-email"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('email')}
        />
        {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
      </div>

      <div>
        <label htmlFor="invite-fullName" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          ชื่อ-สกุล
        </label>
        <input
          id="invite-fullName"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('fullName')}
        />
        {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>}
      </div>

      <div>
        <label htmlFor="invite-employeeCode" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          รหัสพนักงาน (ถ้ามี)
        </label>
        <input
          id="invite-employeeCode"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('employeeCode')}
        />
      </div>

      <div>
        <label htmlFor="invite-department" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          หน่วยงาน
        </label>
        <select
          id="invite-department"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('departmentId')}
        >
          <option value="">— ไม่ระบุ —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name_th}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="invite-position" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          ตำแหน่ง
        </label>
        <select
          id="invite-position"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('positionId')}
        >
          <option value="">— ไม่ระบุ —</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name_th}
            </option>
          ))}
        </select>
      </div>

      {serverError && <p className="sm:col-span-2 text-xs text-red-600">{serverError}</p>}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          ส่งคำเชิญ
        </button>
      </div>
    </form>
  );
}

function UserRolesPanel({ userId, allRoles }: { userId: string; allRoles: Role[] }) {
  const queryClient = useQueryClient();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<UserRoleAssignment | null>(null);

  const rolesQuery = useQuery({
    queryKey: ['admin', 'users', userId, 'roles'],
    queryFn: () => apiFetch<UserRoleAssignment[]>(`/api/v1/users/${userId}/roles`),
  });

  const assignMutation = useMutation({
    mutationFn: (roleId: string) =>
      apiFetch(`/api/v1/users/${userId}/roles`, { method: 'POST', body: JSON.stringify({ roleId }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'roles'] }),
  });

  const removeMutation = useMutation({
    mutationFn: (roleId: string) => apiFetch(`/api/v1/users/${userId}/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: () => { setPendingRemoval(null); setRemoveError(null); void queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'roles'] }); },
    onError: (error) => setRemoveError(error instanceof ApiError ? error.message : 'ลบบทบาทไม่สำเร็จ'),
  });

  const assignedRoleIds = new Set((rolesQuery.data ?? []).map((r) => r.role_id));

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">บทบาทของผู้ใช้นี้</p>
      <div className="flex flex-wrap gap-2">
        {(rolesQuery.data ?? []).map((r) => (
          <span
            key={r.id}
            className="flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900 dark:text-primary-200"
          >
            {r.roles?.name_th}
            <button
              type="button"
              onClick={() => { setRemoveError(null); setPendingRemoval(r); }}
              className="text-primary-600 hover:text-red-600"
              aria-label={`ลบบทบาท ${r.roles?.name_th}`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {allRoles
          .filter((role) => !assignedRoleIds.has(role.id))
          .map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => assignMutation.mutate(role.id)}
              className="flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-500 hover:border-primary-400 hover:text-primary-600 dark:border-slate-600 dark:text-slate-400"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {role.name_th}
            </button>
          ))}
      </div>
      {removeError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">{removeError}</p>}
      {pendingRemoval && (
        <DeleteConfirmModal
          title="ยืนยันการถอดบทบาท"
          description={`บทบาท ${pendingRemoval.roles?.name_th ?? ''} จะถูกถอดออกจากผู้ใช้นี้`}
          confirmLabel="ถอดบทบาท"
          isPending={removeMutation.isPending}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => removeMutation.mutate(pendingRemoval.role_id)}
        >
          {removeError && <p role="alert" className="text-sm text-red-600">{removeError}</p>}
        </DeleteConfirmModal>
      )}
    </div>
  );
}

export function UsersPage() {
  const table = useTableParams<'search'>({ filters: ['search'] });
  const { page, pageSize, sort } = table;
  const { search } = table.filters;
  const debouncedSearch = useDebouncedValue(search);
  const [showInvite, setShowInvite] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', page, pageSize, sort?.key, sort?.order, debouncedSearch],
    queryFn: () =>
      apiFetch<PaginatedResult<UserListItem>>(
        `/api/v1/users?page=${page}&pageSize=${pageSize}${sort ? `&sort=${sort.key}&order=${sort.order}` : ''}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`,
      ),
  });

  const departmentsQuery = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => apiFetch<Department[]>('/api/v1/departments'),
  });

  const positionsQuery = useQuery({
    queryKey: ['admin', 'positions'],
    queryFn: () => apiFetch<Position[]>('/api/v1/positions'),
  });

  const rolesQuery = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiFetch<Role[]>('/api/v1/roles'),
  });

  const permissionsQuery = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: () => apiFetch<Permission[]>('/api/v1/permissions'),
  });

  const allUsersQuery = useQuery({
    queryKey: ['admin', 'users', 'for-supervisor-picker'],
    queryFn: () => apiFetch<PaginatedResult<UserListItem>>('/api/v1/users?page=1&pageSize=100'),
  });
  const visibleUsers = usersQuery.data?.items ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">จัดการผู้ใช้งาน</h1>
        <button
          type="button"
          onClick={() => setShowInvite((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          เชิญผู้ใช้ใหม่
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<UsersRound className="h-5 w-5" />} label="ผู้ใช้ทั้งหมด" value={usersQuery.data?.pagination.totalItems ?? 0} tone="primary" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="ใช้งาน (หน้านี้)" value={visibleUsers.filter((user) => user.status === 'active').length} tone="teal" />
        <StatCard icon={<UserMinus className="h-5 w-5" />} label="ระงับ (หน้านี้)" value={visibleUsers.filter((user) => user.status !== 'active').length} tone="gray" />
        <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="บทบาทในระบบ" value={rolesQuery.data?.length ?? 0} note={`${departmentsQuery.data?.length ?? 0} หน่วยงาน`} tone="amber" />
      </div>

      {showInvite && departmentsQuery.data && positionsQuery.data && <FormModal title="เชิญผู้ใช้งาน" description="สร้างคำเชิญและผูกข้อมูลบุคลากรโดยใช้สิทธิ์เดิมของระบบ" size="lg" onClose={() => setShowInvite(false)}><InviteUserForm departments={departmentsQuery.data} positions={positionsQuery.data} onClose={() => setShowInvite(false)} /></FormModal>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="ค้นหาชื่อหรืออีเมล..."
          value={search}
          onChange={(e) => {
            table.setFilter('search', e.target.value, { replace: true });
          }}
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <ExportCsvButton
          disabled={!visibleUsers.length}
          fileName={`users-page-${page}.csv`}
          getRows={() => [
            ['ชื่อ-สกุล', 'อีเมล', 'สถานะ', 'เข้าร่วมเมื่อ'],
            ...visibleUsers.map((user) => [user.full_name, user.email, user.status, formatThaiDate(user.created_at)]),
          ]}
        />
      </div>

      {usersQuery.isLoading && (
        <div className="flex justify-center py-10" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      )}

      {usersQuery.data && usersQuery.data.items.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">ไม่พบผู้ใช้งาน</p>
      )}

      {usersQuery.data && usersQuery.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <DataTable
            mode="server"
            sort={sort}
            onSortChange={table.setSort}
            className="w-full text-left text-sm"
          >
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2" data-sort-key="full_name">ชื่อ-สกุล</th>
                <th className="px-4 py-2" data-sort-key="email">อีเมล</th>
                <th className="px-4 py-2" data-sort-key="status">สถานะ</th>
                <th className="px-4 py-2" data-sort-key="created_at">เข้าร่วมเมื่อ</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {usersQuery.data.items.map((user) => (
                <Fragment key={user.id}>
                  <tr className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-4 py-2 text-slate-800 dark:text-slate-200">{user.full_name}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{user.email}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{formatThaiDate(user.created_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <RowActions
                        recordLabel={user.email}
                        actions={[{
                          kind: 'custom',
                          icon: expandedUserId === user.id ? ChevronUp : ShieldCheck,
                          label: expandedUserId === user.id ? 'ปิด' : 'จัดการบทบาท',
                          onClick: () => setExpandedUserId(expandedUserId === user.id ? null : user.id),
                        }]}
                      />
                    </td>
                  </tr>
                  {expandedUserId === user.id && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <UserRolesPanel userId={user.id} allRoles={rolesQuery.data ?? []} />
                        <SupervisorPanel user={user} allUsers={allUsersQuery.data?.items ?? []} />
                        <RequirePermission permission="role.manage">
                          <UserPermissionOverridesPanel userId={user.id} allPermissions={permissionsQuery.data ?? []} />
                        </RequirePermission>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}

      {usersQuery.data && <TablePagination page={usersQuery.data.pagination.page} pageSize={pageSize} totalItems={usersQuery.data.pagination.totalItems} totalPages={usersQuery.data.pagination.totalPages} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} />}
    </div>
  );
}
