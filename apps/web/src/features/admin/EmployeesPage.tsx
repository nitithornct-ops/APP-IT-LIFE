import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, UserSquare2, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Department, Employee, PaginatedResult, Position } from '../../types/admin';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

function StatusBadge({ status }: { status: 'active' | 'inactive' }) {
  return <Badge variant={status === 'active' ? 'success' : 'secondary'}>{status === 'active' ? 'ใช้งาน' : 'ระงับ'}</Badge>;
}

const employeeSchema = z.object({
  employeeCode: z.string().trim().min(1, 'กรุณากรอกรหัสพนักงาน'),
  firstNameTh: z.string().trim().min(1, 'กรุณากรอกชื่อ'),
  lastNameTh: z.string().trim().min(1, 'กรุณากรอกนามสกุล'),
  nickname: z.string().trim().optional(),
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
  email: z.string().trim().email('รูปแบบ Email ไม่ถูกต้อง').optional().or(z.literal('')),
});

type EmployeeForm = z.infer<typeof employeeSchema>;

function CreateEmployeeForm({
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
  } = useForm<EmployeeForm>({ resolver: zodResolver(employeeSchema) });

  const mutation = useMutation({
    mutationFn: (values: EmployeeForm) =>
      apiFetch('/api/v1/employees', {
        method: 'POST',
        // <select> ที่ไม่ได้เลือก ("— ไม่ระบุ —") จะส่งค่าเป็น "" เสมอ — ต้องแปลงเป็น undefined
        // ก่อนส่ง มิฉะนั้น backend (z.string().uuid().optional()) จะปฏิเสธด้วย "Invalid uuid"
        body: JSON.stringify({
          ...values,
          departmentId: values.departmentId || undefined,
          positionId: values.positionId || undefined,
          email: values.email || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มพนักงานไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มพนักงาน</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="emp-code" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          รหัสพนักงาน
        </label>
        <input
          id="emp-code"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('employeeCode')}
        />
        {errors.employeeCode && <p className="mt-1 text-xs text-red-600">{errors.employeeCode.message}</p>}
      </div>

      <div>
        <label htmlFor="emp-nickname" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชื่อเล่น
        </label>
        <input
          id="emp-nickname"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('nickname')}
        />
      </div>

      <div>
        <label htmlFor="emp-firstname" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชื่อ
        </label>
        <input
          id="emp-firstname"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('firstNameTh')}
        />
        {errors.firstNameTh && <p className="mt-1 text-xs text-red-600">{errors.firstNameTh.message}</p>}
      </div>

      <div>
        <label htmlFor="emp-lastname" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          นามสกุล
        </label>
        <input
          id="emp-lastname"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('lastNameTh')}
        />
        {errors.lastNameTh && <p className="mt-1 text-xs text-red-600">{errors.lastNameTh.message}</p>}
      </div>

      <div>
        <label htmlFor="emp-department" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          หน่วยงาน
        </label>
        <select
          id="emp-department"
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
        <label htmlFor="emp-position" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ตำแหน่ง
        </label>
        <select
          id="emp-position"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
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

      <div className="sm:col-span-2">
        <label htmlFor="emp-email" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          Email (ถ้ามี)
        </label>
        <input
          id="emp-email"
          type="email"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('email')}
        />
        {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
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

export function EmployeesPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const employeesQuery = useQuery({
    queryKey: ['admin', 'employees', page, debouncedSearch],
    queryFn: () =>
      apiFetch<PaginatedResult<Employee>>(
        `/api/v1/employees?page=${page}&pageSize=20${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`,
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

  const departmentById = new Map((departmentsQuery.data ?? []).map((d) => [d.id, d.name_th]));
  const positionById = new Map((positionsQuery.data ?? []).map((p) => [p.id, p.name_th]));

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      apiFetch(`/api/v1/employees/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">ทะเบียนพนักงาน</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            ใช้เป็นเจ้าของทรัพย์สินและผู้ร้องขอในโมดูล Ticket/Asset ที่จะตามมา
          </p>
        </div>
        <RequirePermission permission="employee.manage">
          <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มพนักงาน
          </Button>
        </RequirePermission>
      </div>

      <Card>
        <CardHeader>รายชื่อพนักงาน</CardHeader>
        <CardBody>
          {showCreate && departmentsQuery.data && positionsQuery.data && (
            <CreateEmployeeForm
              departments={departmentsQuery.data}
              positions={positionsQuery.data}
              onClose={() => setShowCreate(false)}
            />
          )}

          <input
            type="search"
            placeholder="ค้นหารหัสพนักงาน ชื่อ หรืออีเมล..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="mb-3 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          />

          {employeesQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {employeesQuery.data && employeesQuery.data.items.length === 0 && (
            <EmptyState icon={<UserSquare2 className="h-10 w-10" aria-hidden="true" />} title="ไม่พบพนักงาน" />
          )}

          {employeesQuery.data && employeesQuery.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">รหัสพนักงาน</th>
                    <th className="px-2 py-2">ชื่อ-สกุล</th>
                    <th className="px-2 py-2">หน่วยงาน</th>
                    <th className="px-2 py-2">ตำแหน่ง</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {employeesQuery.data.items.map((emp) => (
                    <tr key={emp.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{emp.employee_code}</td>
                      <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">
                        {[emp.prefix_th, emp.first_name_th, emp.last_name_th].filter(Boolean).join(' ')}
                        {emp.nickname && <span className="ml-1 text-xs text-slate-400">({emp.nickname})</span>}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                        {emp.department_id ? (departmentById.get(emp.department_id) ?? '—') : '—'}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                        {emp.position_id ? (positionById.get(emp.position_id) ?? '—') : '—'}
                      </td>
                      <td className="px-2 py-2">
                        <StatusBadge status={emp.status} />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <RequirePermission permission="employee.manage">
                          <button
                            type="button"
                            onClick={() =>
                              toggleStatusMutation.mutate({ id: emp.id, status: emp.status === 'active' ? 'inactive' : 'active' })
                            }
                            className="text-xs text-primary-700 hover:underline dark:text-primary-300"
                          >
                            {emp.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน'}
                          </button>
                        </RequirePermission>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {employeesQuery.data && employeesQuery.data.pagination.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-600"
              >
                ก่อนหน้า
              </button>
              <span className="text-slate-500 dark:text-slate-400">
                หน้า {employeesQuery.data.pagination.page} / {employeesQuery.data.pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= employeesQuery.data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-600"
              >
                ถัดไป
              </button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
