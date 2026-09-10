import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { RowActions } from '../../components/table/RowActions';
import { ConfirmModal, DeleteConfirmModal, FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, ChevronUp, Eye, EyeOff, KeyRound, Loader2, Plus, ShieldAlert, ShieldCheck, UserCog, UserMinus, UserPlus, UsersRound, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { RequirePermission } from '../../components/RequirePermission';
import { StatCard } from '../../components/ui/Card';
import { PageTitle } from '../../components/ui/PageTitle';
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
                {u.full_name} ({loginIdentityOf(u)})
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

/**
 * สิ่งที่ผู้ใช้พิมพ์ตอนเข้าสู่ระบบ — บัญชีที่ไม่มีอีเมลจริงถูกผูกไว้กับอีเมลภายในของโดเมน no-email.invalid
 * ซึ่งไม่มีความหมายกับคนอ่านและใช้ติดต่อไม่ได้ จึงต้องแสดงชื่อผู้ใช้แทนทุกที่ที่เคยแสดงอีเมล
 */
function loginIdentityOf(user: UserListItem): string {
  return user.username ?? user.email;
}

function StatusBadge({ status }: { status: 'active' | 'inactive' }) {
  return (
    <Badge variant={status === 'active' ? 'success' : 'secondary'}>
      {status === 'active' ? 'ใช้งาน' : 'ระงับ'}
    </Badge>
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

/**
 * ชื่อผู้ใช้รับได้ทั้งตัวพิมพ์ใหญ่/เล็กตรงนี้ แล้ว Backend แปลงเป็นตัวพิมพ์เล็กให้ (ตอน login ก็เทียบแบบไม่สนตัวพิมพ์)
 * จึงไม่ต้องบังคับให้ผู้ดูแลพิมพ์เล็กเองให้เสียเวลา
 */
const createLocalUserSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{3,32}$/, 'ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดล่าง และขีดกลาง ความยาว 3-32 ตัวอักษร'),
  password: z
    .string()
    .min(12, 'รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร')
    .regex(/[a-z]/, 'ต้องมีตัวอักษรภาษาอังกฤษตัวเล็ก')
    .regex(/[A-Z]/, 'ต้องมีตัวอักษรภาษาอังกฤษตัวใหญ่')
    .regex(/[0-9]/, 'ต้องมีตัวเลข'),
  fullName: z.string().trim().min(1, 'กรุณากรอกชื่อ-สกุล'),
  employeeCode: z.string().trim().optional(),
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
});

type CreateLocalUserForm = z.infer<typeof createLocalUserSchema>;

/** ช่องรหัสผ่านที่ผู้ดูแลต้องอ่านออกเพื่อนำไปแจ้งผู้ใช้ จึงมีปุ่มเปิด/ปิดการมองเห็นให้ตรวจทานก่อนบันทึก */
function PasswordField({
  id,
  label,
  error,
  registration,
}: {
  id: string;
  label: string;
  error?: string;
  registration: ReturnType<ReturnType<typeof useForm<CreateLocalUserForm>>['register']>;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 pr-9 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...registration}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * สร้างบัญชีให้ผู้ใช้ที่ไม่มีอีเมลองค์กร — ต่างจากการเชิญทางอีเมลตรงที่ไม่มีลิงก์ให้ผู้ใช้ไปตั้งรหัสผ่านเอง
 * ผู้ดูแลจึงตั้งรหัสผ่านเริ่มต้นให้แล้วแจ้งผู้ใช้ด้วยช่องทางอื่น และเปลี่ยนให้ใหม่ได้ภายหลังจากปุ่มในตาราง
 */
function CreateLocalUserForm({
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
  } = useForm<CreateLocalUserForm>({ resolver: zodResolver(createLocalUserSchema) });

  const mutation = useMutation({
    mutationFn: (values: CreateLocalUserForm) =>
      apiFetch('/api/v1/users/local', {
        method: 'POST',
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
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างบัญชีไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800"
      noValidate
    >
      <div className="sm:col-span-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">สร้างบัญชีด้วยชื่อผู้ใช้</h2>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <p className="sm:col-span-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        บัญชีนี้ไม่มีอีเมล จึงใช้ "ลืมรหัสผ่าน" ด้วยตนเองไม่ได้ กรุณาแจ้งชื่อผู้ใช้และรหัสผ่านให้เจ้าตัวด้วยช่องทางที่ปลอดภัย
        หากลืมรหัสผ่านภายหลัง ผู้ดูแลระบบเป็นผู้ตั้งให้ใหม่จากปุ่ม "ตั้งรหัสผ่านใหม่" ในตาราง
      </p>

      <div>
        <label htmlFor="local-username" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          ชื่อผู้ใช้ (สำหรับเข้าสู่ระบบ)
        </label>
        <input
          id="local-username"
          autoComplete="off"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('username')}
        />
        {errors.username ? (
          <p className="mt-1 text-xs text-red-600">{errors.username.message}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">ระบบจะบันทึกเป็นตัวพิมพ์เล็กทั้งหมด และเข้าสู่ระบบได้โดยไม่ต้องสนตัวพิมพ์</p>
        )}
      </div>

      <PasswordField
        id="local-password"
        label="รหัสผ่านเริ่มต้น"
        error={errors.password?.message}
        registration={register('password')}
      />

      <div>
        <label htmlFor="local-fullName" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          ชื่อ-สกุล
        </label>
        <input
          id="local-fullName"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('fullName')}
        />
        {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>}
      </div>

      <div>
        <label htmlFor="local-employeeCode" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          รหัสพนักงาน (ถ้ามี)
        </label>
        <input
          id="local-employeeCode"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('employeeCode')}
        />
      </div>

      <div>
        <label htmlFor="local-department" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          หน่วยงาน
        </label>
        <select
          id="local-department"
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
        <label htmlFor="local-position" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
          ตำแหน่ง
        </label>
        <select
          id="local-position"
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
          สร้างบัญชี
        </button>
      </div>
    </form>
  );
}

const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(12, 'รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร')
    .regex(/[a-z]/, 'ต้องมีตัวอักษรภาษาอังกฤษตัวเล็ก')
    .regex(/[A-Z]/, 'ต้องมีตัวอักษรภาษาอังกฤษตัวใหญ่')
    .regex(/[0-9]/, 'ต้องมีตัวเลข'),
});

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

/** ผู้ดูแลตั้งรหัสผ่านใหม่ให้ผู้ใช้ — ทางเดียวที่บัญชีชื่อผู้ใช้กู้รหัสผ่านได้ เพราะไม่มีอีเมลรับลิงก์รีเซ็ต */
function ResetPasswordModal({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordForm>({ resolver: zodResolver(resetPasswordSchema) });

  const mutation = useMutation({
    mutationFn: (values: ResetPasswordForm) =>
      apiFetch(`/api/v1/users/${user.id}/reset-password`, { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: onClose,
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ'),
  });

  return (
    <FormModal
      title="ตั้งรหัสผ่านใหม่"
      description={`สำหรับบัญชี ${user.username ?? user.email}`}
      size="sm"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="flex flex-col gap-3" noValidate>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          ผู้ใช้จะเข้าสู่ระบบด้วยรหัสผ่านเดิมไม่ได้อีก กรุณาแจ้งรหัสผ่านใหม่ให้เจ้าตัวด้วยช่องทางที่ปลอดภัย
        </p>

        <div>
          <label htmlFor="reset-password" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
            รหัสผ่านใหม่
          </label>
          <div className="relative">
            <input
              id="reset-password"
              type={visible ? 'text' : 'password'}
              autoComplete="new-password"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 pr-9 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
        </div>

        {serverError && <p className="text-xs text-red-600" role="alert">{serverError}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm dark:border-slate-600 dark:text-slate-200">
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            บันทึกรหัสผ่านใหม่
          </button>
        </div>
      </form>
    </FormModal>
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
  const [showCreateLocal, setShowCreateLocal] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<UserListItem | null>(null);
  const [pendingMfaChange, setPendingMfaChange] = useState<UserListItem | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<UserListItem | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const queryClient = useQueryClient();

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

  // ระงับ/เปิดใช้งานบัญชี — Backend สั่ง ban ที่ Supabase Auth ให้ด้วย และ middleware ตรวจสถานะทุก request
  // ผู้ใช้ที่ค้าง session อยู่จึงถูกตัดออกจากระบบทันทีโดยไม่ต้องรอ JWT หมดอายุ
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      apiFetch(`/api/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      setPendingStatusChange(null);
      setStatusError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => setStatusError(error instanceof ApiError ? error.message : 'เปลี่ยนสถานะบัญชีไม่สำเร็จ'),
  });

  const mfaMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/api/v1/users/${id}/mfa`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      setPendingMfaChange(null);
      setMfaError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => setMfaError(error instanceof ApiError ? error.message : 'เปลี่ยนสถานะ 2FA ไม่สำเร็จ'),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <PageTitle eyebrow="บุคลากรและสิทธิ์ / ผู้ใช้งาน" title="จัดการผู้ใช้งาน" description="เชิญผู้ใช้เข้าระบบ กำหนดบทบาท และระงับบัญชีที่ไม่ได้ใช้งานแล้ว" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreateLocal((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <UserCog className="h-4 w-4" aria-hidden="true" />
            สร้างบัญชีด้วยชื่อผู้ใช้
          </button>
          <button
            type="button"
            onClick={() => setShowInvite((v) => !v)}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            เชิญทางอีเมล
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<UsersRound className="h-5 w-5" />} label="ผู้ใช้ทั้งหมด" value={usersQuery.data?.pagination.totalItems ?? 0} tone="primary" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="ใช้งาน (หน้านี้)" value={visibleUsers.filter((user) => user.status === 'active').length} tone="teal" />
        <StatCard icon={<UserMinus className="h-5 w-5" />} label="ระงับ (หน้านี้)" value={visibleUsers.filter((user) => user.status !== 'active').length} tone="gray" />
        <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="บทบาทในระบบ" value={rolesQuery.data?.length ?? 0} note={`${departmentsQuery.data?.length ?? 0} หน่วยงาน`} tone="amber" />
      </div>

      {showInvite && departmentsQuery.data && positionsQuery.data && <FormModal title="เชิญผู้ใช้งาน" description="สร้างคำเชิญและผูกข้อมูลบุคลากรโดยใช้สิทธิ์เดิมของระบบ" size="lg" onClose={() => setShowInvite(false)}><InviteUserForm departments={departmentsQuery.data} positions={positionsQuery.data} onClose={() => setShowInvite(false)} /></FormModal>}

      {showCreateLocal && departmentsQuery.data && positionsQuery.data && <FormModal title="สร้างบัญชีด้วยชื่อผู้ใช้" description="สำหรับผู้ใช้ที่ไม่มีอีเมลองค์กร เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน" size="lg" onClose={() => setShowCreateLocal(false)}><CreateLocalUserForm departments={departmentsQuery.data} positions={positionsQuery.data} onClose={() => setShowCreateLocal(false)} /></FormModal>}

      {resetPasswordTarget && <ResetPasswordModal user={resetPasswordTarget} onClose={() => setResetPasswordTarget(null)} />}

      {pendingStatusChange && (
        <ConfirmModal
          title={pendingStatusChange.status === 'active' ? 'ยืนยันการระงับบัญชี' : 'ยืนยันการเปิดใช้งานบัญชี'}
          description={
            pendingStatusChange.status === 'active'
              ? `${pendingStatusChange.full_name} จะถูกตัดออกจากระบบทันที และเข้าสู่ระบบใหม่ไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง ข้อมูลและประวัติการทำงานทั้งหมดยังอยู่ครบ`
              : `${pendingStatusChange.full_name} จะกลับมาเข้าสู่ระบบได้อีกครั้ง ด้วยบทบาทและสิทธิ์เดิมที่เคยมี`
          }
          tone={pendingStatusChange.status === 'active' ? 'danger' : 'primary'}
          confirmLabel={pendingStatusChange.status === 'active' ? 'ระงับการใช้งาน' : 'เปิดใช้งาน'}
          cancelLabel="ไม่ใช่ตอนนี้"
          isPending={statusMutation.isPending}
          onConfirm={() =>
            statusMutation.mutate({
              id: pendingStatusChange.id,
              status: pendingStatusChange.status === 'active' ? 'inactive' : 'active',
            })
          }
          onClose={() => { setPendingStatusChange(null); setStatusError(null); }}
        >
          {statusError && <p role="alert" className="text-sm text-red-600">{statusError}</p>}
        </ConfirmModal>
      )}

      {pendingMfaChange && (
        <ConfirmModal
          title={pendingMfaChange.mfa_enabled ? 'ยืนยันการปิด 2FA' : 'ยืนยันการเปิด 2FA'}
          description={pendingMfaChange.mfa_enabled
            ? `${pendingMfaChange.full_name} จะไม่ต้องยืนยันตัวตนสองขั้นตอนในการเข้าสู่ระบบครั้งถัดไป และอุปกรณ์ Authenticator ที่ผูกไว้จะถูกลบ`
            : `${pendingMfaChange.full_name} จะต้องตั้งค่า Authenticator ในการเข้าสู่ระบบครั้งถัดไป โดยระบบจะแสดง QR ให้สแกน`}
          tone={pendingMfaChange.mfa_enabled ? 'danger' : 'primary'}
          confirmLabel={pendingMfaChange.mfa_enabled ? 'ปิด 2FA' : 'เปิด 2FA'}
          cancelLabel="ยกเลิก"
          isPending={mfaMutation.isPending}
          onConfirm={() => mfaMutation.mutate({ id: pendingMfaChange.id, enabled: !pendingMfaChange.mfa_enabled })}
          onClose={() => { setPendingMfaChange(null); setMfaError(null); }}
        >
          {mfaError && <p role="alert" className="text-sm text-red-600">{mfaError}</p>}
        </ConfirmModal>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="ค้นหาชื่อ อีเมล หรือชื่อผู้ใช้..."
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
            ['ชื่อ-สกุล', 'อีเมล / ชื่อผู้ใช้', 'สถานะ', '2FA', 'เข้าร่วมเมื่อ'],
            ...visibleUsers.map((user) => [user.full_name, loginIdentityOf(user), user.status, user.mfa_enabled ? 'เปิด' : 'ปิด', formatThaiDate(user.created_at)]),
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
            rowNumberStart={(page - 1) * pageSize + 1}
            className="w-full text-left text-sm"
          >
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2" data-sort-key="full_name">ชื่อ-สกุล</th>
                <th className="px-4 py-2" data-sort-key="email">อีเมล / ชื่อผู้ใช้</th>
                <th className="px-4 py-2" data-sort-key="status">สถานะ</th>
                <th className="px-4 py-2">2FA</th>
                <th className="px-4 py-2" data-sort-key="created_at">เข้าร่วมเมื่อ</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {usersQuery.data.items.map((user) => (
                <Fragment key={user.id}>
                  <tr className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-4 py-2 text-slate-800 dark:text-slate-200">{user.full_name}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                      <span className="flex items-center gap-2">
                        {loginIdentityOf(user)}
                        {user.username && <Badge variant="secondary">ชื่อผู้ใช้</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={user.mfa_enabled ? 'success' : 'secondary'}>{user.mfa_enabled ? 'เปิด' : 'ปิด'}</Badge>
                        <Button
                          size="sm"
                          variant={user.mfa_enabled ? 'danger' : 'outline'}
                          aria-label={`${user.mfa_enabled ? 'ปิด' : 'เปิด'} 2FA ${loginIdentityOf(user)}`}
                          data-testid={`mfa-toggle-${user.id}`}
                          onClick={() => { setMfaError(null); setPendingMfaChange(user); }}
                        >
                          {user.mfa_enabled ? 'ปิด 2FA' : 'เปิด 2FA'}
                        </Button>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{formatThaiDate(user.created_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <RowActions
                        recordLabel={loginIdentityOf(user)}
                        actions={[
                          {
                            kind: 'custom',
                            icon: expandedUserId === user.id ? ChevronUp : ShieldCheck,
                            label: expandedUserId === user.id ? 'ปิด' : 'จัดการบทบาท',
                            onClick: () => setExpandedUserId(expandedUserId === user.id ? null : user.id),
                          },
                          {
                            kind: 'custom',
                            icon: KeyRound,
                            label: 'ตั้งรหัสผ่านใหม่',
                            onClick: () => setResetPasswordTarget(user),
                          },
                          {
                            kind: 'custom',
                            icon: user.status === 'active' ? Ban : CheckCircle2,
                            label: user.status === 'active' ? 'ระงับการใช้งาน' : 'เปิดใช้งาน',
                            onClick: () => { setStatusError(null); setPendingStatusChange(user); },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                  {expandedUserId === user.id && (
                    <tr>
                      <td colSpan={6} className="p-0">
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
