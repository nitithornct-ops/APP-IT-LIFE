import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop2, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Employee, PaginatedResult } from '../../types/admin';
import type { AssetOption, EmployeeAssignment } from '../../types/assets';
import { EMPLOYEE_ASSET_CATEGORIES, EMPLOYEE_ASSIGNMENT_STATUSES } from '../../types/assets';
import { formatThaiDate } from '../../utils/date';

const statusTone: Record<string, 'primary' | 'success' | 'warning' | 'danger'> = {
  ครอบครอง: 'primary',
  คืนแล้ว: 'success',
  ส่งซ่อม: 'warning',
  สูญหาย: 'danger',
};

function CreateAssignmentForm({ employees, assets, onClose }: { employees: Employee[]; assets: AssetOption[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [category, setCategory] = useState<(typeof EMPLOYEE_ASSET_CATEGORIES)[number]>('Computer');
  const [itemName, setItemName] = useState('');
  const [assetId, setAssetId] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/employee-assignments', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          category,
          itemName: itemName || undefined,
          assetId: assetId || undefined,
          serialNumber: serialNumber || undefined,
          notes: notes || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employee-assignments'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มรายการครอบครองไม่สำเร็จ'),
  });

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-center justify-between sm:col-span-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มรายการครอบครอง</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">พนักงาน</label>
        <select data-testid="ea-create-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          <option value="">— เลือกพนักงาน —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{[e.prefix_th, e.first_name_th, e.last_name_th].filter(Boolean).join(' ')}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ประเภท</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as (typeof EMPLOYEE_ASSET_CATEGORIES)[number])} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          {EMPLOYEE_ASSET_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ทรัพย์สินที่ขึ้นทะเบียน (ถ้ามี)</label>
        <select data-testid="ea-create-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          <option value="">— ไม่ผูก Asset —</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.asset_code} — {a.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อรายการ (ถ้าไม่ผูก Asset)</label>
        <input data-testid="ea-create-itemname" value={itemName} onChange={(e) => setItemName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">S/N</label>
        <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}
      <div className="sm:col-span-3">
        <Button size="sm" isLoading={mutation.isPending} disabled={!employeeId || (!assetId && !itemName.trim())} data-testid="ea-create-submit" onClick={() => mutation.mutate()}>
          บันทึกรายการครอบครอง
        </Button>
      </div>
    </div>
  );
}

function AssignmentStatusControl({ assignment }: { assignment: EmployeeAssignment }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(assignment.status);
  const mutation = useMutation({
    mutationFn: (status: string) => apiFetch(`/api/v1/employee-assignments/${assignment.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['employee-assignments'] }),
  });
  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value as EmployeeAssignment['status'])}
        data-testid={`ea-status-select-${assignment.id}`}
        className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
      >
        {EMPLOYEE_ASSIGNMENT_STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <Button size="sm" variant="outline" isLoading={mutation.isPending} disabled={value === assignment.status} data-testid={`ea-status-save-${assignment.id}`} onClick={() => mutation.mutate(value)}>
        บันทึก
      </Button>
    </div>
  );
}

export function EmployeeAssignmentsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');

  const employeesQuery = useQuery({ queryKey: ['admin', 'employees', 'all'], queryFn: () => apiFetch<PaginatedResult<Employee>>('/api/v1/employees?page=1&pageSize=100') });
  const assetsQuery = useQuery({ queryKey: ['assets', 'options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options') });

  const assignmentsQuery = useQuery({
    queryKey: ['employee-assignments', employeeId, status],
    queryFn: () =>
      apiFetch<PaginatedResult<EmployeeAssignment>>(
        `/api/v1/employee-assignments?page=1&pageSize=50${employeeId ? `&employeeId=${employeeId}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
      ),
  });

  const employees = employeesQuery.data?.items ?? [];
  const items = assignmentsQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">ทรัพย์สินที่พนักงานครอบครอง</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">อุปกรณ์/ซอฟต์แวร์ที่มอบให้พนักงานแต่ละคนถือครอง</p>
        </div>
        <RequirePermission permission="employee.manage">
          <Button size="sm" onClick={() => setShowCreate((v) => !v)} data-testid="ea-create-toggle">
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มรายการ
          </Button>
        </RequirePermission>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการครอบครอง</span>
          <div className="flex flex-wrap items-center gap-2 text-xs font-normal">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900">
              <option value="">ทุกพนักงาน</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{[e.prefix_th, e.first_name_th, e.last_name_th].filter(Boolean).join(' ')}</option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900">
              <option value="">ทุกสถานะ</option>
              {EMPLOYEE_ASSIGNMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {showCreate && <CreateAssignmentForm employees={employees} assets={assetsQuery.data ?? []} onClose={() => setShowCreate(false)} />}

          {assignmentsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}
          {assignmentsQuery.data && items.length === 0 && <EmptyState icon={<Laptop2 className="h-10 w-10" aria-hidden="true" />} title="ไม่พบรายการครอบครอง" />}

          <div className="flex flex-col gap-2">
            {items.map((a) => (
              <div key={a.id} data-testid={`ea-row-${a.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-3 dark:border-slate-700">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {a.item_name} <span className="text-xs text-slate-400">({a.category})</span>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {a.employee ? [a.employee.first_name_th, a.employee.last_name_th].join(' ') : '—'}
                    {a.serial_number && ` · S/N ${a.serial_number}`}
                    {a.assigned_date && ` · รับเมื่อ ${formatThaiDate(a.assigned_date, 'd MMM yyyy')}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusTone[a.status]}>{a.status}</Badge>
                  <RequirePermission permission="employee.manage">
                    <AssignmentStatusControl assignment={a} />
                  </RequirePermission>
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
