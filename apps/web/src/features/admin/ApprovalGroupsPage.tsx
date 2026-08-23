import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, ChevronUp, Loader2, PauseCircle, Plus, Users2, UsersRound, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { ApprovalGroup, ApprovalGroupMember, Department, PaginatedResult, UserListItem } from '../../types/admin';

function StatusBadge({ status }: { status: 'active' | 'inactive' }) {
  return <Badge variant={status === 'active' ? 'success' : 'secondary'}>{status === 'active' ? 'ใช้งาน' : 'ระงับ'}</Badge>;
}

const memberRoleLabel: Record<ApprovalGroupMember['member_role'], string> = {
  primary: 'หลัก',
  member: 'สมาชิก',
  backup: 'สำรอง',
};

const groupSchema = z.object({
  code: z.string().trim().min(2, 'อย่างน้อย 2 ตัวอักษร').max(80),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อกลุ่ม'),
  departmentId: z.string().optional(),
  description: z.string().trim().optional(),
});

type GroupForm = z.infer<typeof groupSchema>;

function CreateGroupForm({ departments, onClose }: { departments: Department[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<GroupForm>({ resolver: zodResolver(groupSchema) });

  const mutation = useMutation({
    mutationFn: (values: GroupForm) =>
      apiFetch('/api/v1/approval-groups', {
        method: 'POST',
        body: JSON.stringify({ ...values, departmentId: values.departmentId || undefined }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'approval-groups'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างกลุ่มอนุมัติไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มกลุ่มอนุมัติ</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="ag-code" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          รหัสกลุ่ม
        </label>
        <input
          id="ag-code"
          placeholder="เช่น IT-CHANGE"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm uppercase dark:border-slate-600 dark:bg-slate-900"
          {...register('code')}
        />
        {errors.code && <p className="mt-1 text-xs text-red-600">{errors.code.message}</p>}
      </div>

      <div>
        <label htmlFor="ag-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชื่อกลุ่ม
        </label>
        <input
          id="ag-name"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('name')}
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label htmlFor="ag-department" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          หน่วยงาน (ถ้ามี)
        </label>
        <select
          id="ag-department"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
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
        <label htmlFor="ag-desc" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          คำอธิบาย
        </label>
        <input
          id="ag-desc"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('description')}
        />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" size="sm" isLoading={isSubmitting}>
          บันทึก
        </Button>
      </div>
    </form>
  );
}

const memberSchema = z.object({
  userId: z.string().min(1, 'กรุณาเลือกผู้ใช้'),
  memberRole: z.enum(['primary', 'member', 'backup']),
  priority: z.coerce.number().int().min(1).max(999).optional(),
});

type MemberForm = z.infer<typeof memberSchema>;

function GroupMembersPanel({ groupId, allUsers }: { groupId: string; allUsers: UserListItem[] }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const queryKey = ['admin', 'approval-groups', groupId, 'members'];

  const membersQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<ApprovalGroupMember[]>(`/api/v1/approval-groups/${groupId}/members`),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MemberForm>({ resolver: zodResolver(memberSchema), defaultValues: { memberRole: 'member', priority: 100 } });

  const addMutation = useMutation({
    mutationFn: (values: MemberForm) =>
      apiFetch(`/api/v1/approval-groups/${groupId}/members`, { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      reset();
      setShowAdd(false);
      setServerError(null);
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มสมาชิกไม่สำเร็จ'),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ memberId, status }: { memberId: string; status: 'active' | 'inactive' }) =>
      apiFetch(`/api/v1/approval-groups/${groupId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">สมาชิกกลุ่มอนุมัติ</p>
        <RequirePermission permission="approval_group.manage">
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 text-xs text-primary-700 hover:underline dark:text-primary-300"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            เพิ่มสมาชิก
          </button>
        </RequirePermission>
      </div>

      {showAdd && (
        <form
          onSubmit={handleSubmit((values) => addMutation.mutate(values))}
          className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-800"
          noValidate
        >
          <div>
            <label htmlFor={`m-user-${groupId}`} className="mb-1 block text-xs text-slate-600 dark:text-slate-300">
              ผู้ใช้
            </label>
            <select
              id={`m-user-${groupId}`}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('userId')}
            >
              <option value="">— เลือกผู้ใช้ —</option>
              {allUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.email})
                </option>
              ))}
            </select>
            {errors.userId && <p className="mt-1 text-xs text-red-600">{errors.userId.message}</p>}
          </div>

          <div>
            <label htmlFor={`m-role-${groupId}`} className="mb-1 block text-xs text-slate-600 dark:text-slate-300">
              บทบาทในกลุ่ม
            </label>
            <select
              id={`m-role-${groupId}`}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('memberRole')}
            >
              <option value="primary">หลัก</option>
              <option value="member">สมาชิก</option>
              <option value="backup">สำรอง</option>
            </select>
          </div>

          <div>
            <label htmlFor={`m-priority-${groupId}`} className="mb-1 block text-xs text-slate-600 dark:text-slate-300">
              ลำดับความสำคัญ
            </label>
            <input
              id={`m-priority-${groupId}`}
              type="number"
              min={1}
              max={999}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('priority')}
            />
          </div>

          {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}

          <div className="sm:col-span-3">
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

      {membersQuery.data && membersQuery.data.length === 0 && (
        <p className="text-xs text-slate-400">ยังไม่มีสมาชิกในกลุ่มนี้</p>
      )}

      {membersQuery.data && membersQuery.data.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {membersQuery.data.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <span className="flex items-center gap-2">
                <Badge variant="primary">{memberRoleLabel[m.member_role]}</Badge>
                <span className="text-slate-700 dark:text-slate-200">{m.profiles?.full_name ?? m.user_id}</span>
                <span className="text-slate-400">ลำดับ {m.priority}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge status={m.status} />
                <RequirePermission permission="approval_group.manage">
                  <button
                    type="button"
                    onClick={() =>
                      toggleStatusMutation.mutate({ memberId: m.id, status: m.status === 'active' ? 'inactive' : 'active' })
                    }
                    className="text-primary-700 hover:underline dark:text-primary-300"
                  >
                    {m.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน'}
                  </button>
                </RequirePermission>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ApprovalGroupsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: ['admin', 'approval-groups'],
    queryFn: () => apiFetch<ApprovalGroup[]>('/api/v1/approval-groups'),
  });

  const departmentsQuery = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => apiFetch<Department[]>('/api/v1/departments'),
  });

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', 'for-approval-group-picker'],
    queryFn: () => apiFetch<PaginatedResult<UserListItem>>('/api/v1/users?page=1&pageSize=100'),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageTitle eyebrow="บุคลากรและสิทธิ์ / กลุ่มอนุมัติ" title="กลุ่มอนุมัติ" description="ใช้กำหนดเส้นทางการอนุมัติสำหรับโมดูล Workflow / Access Request / Change ที่จะตามมา" />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<Users2 className="h-5 w-5" />} label="กลุ่มทั้งหมด" value={groupsQuery.data?.length ?? 0} tone="primary" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="กลุ่มที่ใช้งาน" value={groupsQuery.data?.filter((group) => group.status === 'active').length ?? 0} tone="teal" />
        <StatCard icon={<PauseCircle className="h-5 w-5" />} label="กลุ่มที่ระงับ" value={groupsQuery.data?.filter((group) => group.status === 'inactive').length ?? 0} tone="gray" />
        <StatCard icon={<Building2 className="h-5 w-5" />} label="หน่วยงานที่อ้างอิงได้" value={departmentsQuery.data?.length ?? 0} tone="amber" />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <span>รายการกลุ่มอนุมัติ</span>
          <RequirePermission permission="approval_group.manage">
            <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              เพิ่มกลุ่ม
            </Button>
          </RequirePermission>
        </CardHeader>
        <CardBody>
          {showCreate && departmentsQuery.data && <FormModal title="เพิ่มกลุ่มผู้อนุมัติ" description="กำหนดกลุ่มและเงื่อนไขผู้อนุมัติ" size="lg" onClose={() => setShowCreate(false)}><CreateGroupForm departments={departmentsQuery.data} onClose={() => setShowCreate(false)} /></FormModal>}

          {groupsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {groupsQuery.data && groupsQuery.data.length === 0 && (
            <EmptyState icon={<Users2 className="h-10 w-10" aria-hidden="true" />} title="ยังไม่มีกลุ่มอนุมัติ" />
          )}

          {groupsQuery.data && groupsQuery.data.length > 0 && (
            <div className="overflow-x-auto">
              <DataTable className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">รหัส</th>
                    <th className="px-2 py-2">ชื่อกลุ่ม</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {groupsQuery.data.map((g) => (
                    <Fragment key={g.id}>
                      <tr className="border-t border-slate-100 dark:border-slate-700">
                        <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{g.code}</td>
                        <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{g.name}</td>
                        <td className="px-2 py-2">
                          <StatusBadge status={g.status} />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <RowActions
                            recordLabel={g.name}
                            actions={[{
                              kind: 'custom',
                              icon: expandedGroupId === g.id ? ChevronUp : UsersRound,
                              label: expandedGroupId === g.id ? 'ปิด' : 'จัดการสมาชิก',
                              onClick: () => setExpandedGroupId(expandedGroupId === g.id ? null : g.id),
                            }]}
                          />
                        </td>
                      </tr>
                      {expandedGroupId === g.id && (
                        <tr>
                          <td colSpan={4} className="p-0">
                            <GroupMembersPanel groupId={g.id} allUsers={usersQuery.data?.items ?? []} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
