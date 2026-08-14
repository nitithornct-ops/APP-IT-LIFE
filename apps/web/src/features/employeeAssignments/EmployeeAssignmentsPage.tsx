import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Laptop2, Loader2, PackageCheck, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { apiFetch } from '../../services/apiClient';
import type { EmployeeOption, PaginatedResult } from '../../types/admin';
import type { EmployeeAssignment } from '../../types/assets';
import { EMPLOYEE_ASSIGNMENT_STATUSES } from '../../types/assets';
import { formatThaiDate } from '../../utils/date';

const statusTone: Record<string, 'primary' | 'success' | 'warning' | 'danger'> = {
  ครอบครอง: 'primary',
  คืนแล้ว: 'success',
  ส่งซ่อม: 'warning',
  สูญหาย: 'danger',
};

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
        อัปเดตสถานะ
      </Button>
    </div>
  );
}

export function EmployeeAssignmentsPage() {
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');

  const employeesQuery = useQuery({ queryKey: ['employee-options'], queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options') });
  const assignmentsQuery = useQuery({
    queryKey: ['employee-assignments', employeeId, status],
    queryFn: () =>
      apiFetch<PaginatedResult<EmployeeAssignment>>(
        `/api/v1/employee-assignments?page=1&pageSize=50${employeeId ? `&employeeId=${employeeId}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
      ),
  });

  const employees = employeesQuery.data ?? [];
  const items = assignmentsQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">เบิกจ่าย / คืนทรัพย์สินพนักงาน</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">ติดตามสถานะครอบครอง รับคืน ส่งซ่อม และแจ้งสูญหายของอุปกรณ์หรือสิทธิ์ใช้งาน</p>
        </div>
        <RequirePermission permission="employee.manage">
          <Button size="sm" variant="outline" onClick={() => navigate('/admin/employees')} data-testid="ea-go-employees">
            ไปหน้าพนักงานเพื่อเพิ่มรายการ
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </RequirePermission>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<Laptop2 className="h-5 w-5" />} label="รายการในระบบ" value={assignmentsQuery.data?.pagination.totalItems ?? 0} tone="primary" />
        <StatCard icon={<PackageCheck className="h-5 w-5" />} label="กำลังครอบครอง" value={items.filter((item) => item.status === 'ครอบครอง').length} tone="teal" />
        <StatCard icon={<Wrench className="h-5 w-5" />} label="อยู่ระหว่างส่งซ่อม" value={items.filter((item) => item.status === 'ส่งซ่อม').length} tone="amber" />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="แจ้งสูญหาย" value={items.filter((item) => item.status === 'สูญหาย').length} tone={items.some((item) => item.status === 'สูญหาย') ? 'danger' : 'gray'} />
      </div>

      <div className="rounded-lg border border-primary-200 bg-primary-50/70 px-4 py-3 text-sm text-primary-800 dark:border-primary-900/60 dark:bg-primary-950/30 dark:text-primary-200">
        การเพิ่มหรือแก้ไขข้อมูลพนักงานและรายการที่มอบหมาย ทำจากหน้า <strong>พนักงาน</strong> ส่วนหน้านี้ใช้สำหรับงานปฏิบัติการหลังการมอบหมาย
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการเบิกจ่าย / คืนและสถานะปัจจุบัน</span>
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
