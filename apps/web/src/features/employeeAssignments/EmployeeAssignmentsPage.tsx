import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Laptop2, Loader2, PackageCheck, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RequirePermission } from '../../components/RequirePermission';
import { DataTable, TablePagination } from '../../components/table/DataTable';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { RowActions } from '../../components/table/RowActions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FilterBar, filterControlClass } from '../../components/ui/FilterBar';
import { KpiStrip } from '../../components/ui/KpiStrip';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTableParams } from '../../hooks/useTableParams';
import { apiFetch } from '../../services/apiClient';
import type { EmployeeOption, PaginatedResult } from '../../types/admin';
import type { AssetOption, EmployeeAssignment } from '../../types/assets';
import { EMPLOYEE_ASSIGNMENT_STATUSES } from '../../types/assets';
import { formatThaiDate } from '../../utils/date';
import { EmployeeAssignmentBulkModal } from './EmployeeAssignmentBulkModal';

const statusTone: Record<string, 'primary' | 'success' | 'warning' | 'danger'> = {
  ครอบครอง: 'primary',
  คืนแล้ว: 'success',
  ส่งซ่อม: 'warning',
  สูญหาย: 'danger',
};

function AssignmentStatusControl({ assignment, onSaved }: { assignment: EmployeeAssignment; onSaved?: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(assignment.status);
  const mutation = useMutation({
    mutationFn: (status: string) => apiFetch(`/api/v1/employee-assignments/${assignment.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employee-assignments'] });
      onSaved?.();
    },
  });
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <p className="font-semibold text-slate-800 dark:text-slate-100">{assignment.item_name}</p>
        <p className="mt-1 text-xs text-slate-500">{assignment.employee ? `${assignment.employee.first_name_th} ${assignment.employee.last_name_th}` : 'ไม่พบข้อมูลพนักงาน'}</p>
      </div>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        สถานะปัจจุบัน
      <select
        value={value}
        onChange={(e) => setValue(e.target.value as EmployeeAssignment['status'])}
        data-testid={`ea-status-select-${assignment.id}`}
        className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"
      >
        {EMPLOYEE_ASSIGNMENT_STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      </label>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
        <Button size="sm" isLoading={mutation.isPending} disabled={value === assignment.status} data-testid={`ea-status-save-${assignment.id}`} onClick={() => mutation.mutate(value)}>
          บันทึกการแก้ไข
        </Button>
      </div>
    </div>
  );
}

function AssignmentDetail({ assignment }: { assignment: EmployeeAssignment }) {
  const details = [
    ['พนักงาน', assignment.employee ? `${assignment.employee.first_name_th} ${assignment.employee.last_name_th}` : '—'],
    ['หมวดหมู่', assignment.category],
    ['สถานะ', assignment.status],
    ['รหัสทรัพย์สิน', assignment.asset?.asset_code ?? assignment.asset_code ?? '—'],
    ['Serial Number', assignment.serial_number ?? '—'],
    ['Owner', assignment.owner ? `${assignment.owner.first_name_th} ${assignment.owner.last_name_th}` : 'องค์กร / ไม่ระบุ'],
    ['Custodian / ผู้ถือครอง', assignment.custodian ? `${assignment.custodian.first_name_th} ${assignment.custodian.last_name_th}` : '—'],
    ['ผู้ได้รับมอบหมายใช้งาน', assignment.assigned_user ? `${assignment.assigned_user.first_name_th} ${assignment.assigned_user.last_name_th}` : assignment.employee ? `${assignment.employee.first_name_th} ${assignment.employee.last_name_th}` : '—'],
    ['วันที่เบิก', assignment.checkout_date ? formatThaiDate(assignment.checkout_date, 'd MMM yyyy') : assignment.assigned_date ? formatThaiDate(assignment.assigned_date, 'd MMM yyyy') : '—'],
    ['วันที่คืน', assignment.return_date ? formatThaiDate(assignment.return_date, 'd MMM yyyy') : assignment.returned_date ? formatThaiDate(assignment.returned_date, 'd MMM yyyy') : '—'],
    ['Accessories', assignment.accessories?.length ? assignment.accessories.join(', ') : '—'],
    ['Manager approval', assignment.manager_approval_status === 'approved' ? 'อนุมัติแล้ว' : assignment.manager_approval_status],
    ['เอกสารรับมอบ', assignment.handover_document_name ?? 'ยังไม่มีเอกสารแนบ'],
    ['หมายเหตุ', assignment.notes ?? '—'],
  ];
  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-bold text-slate-900 dark:text-white">{assignment.item_name}</p><p className="mt-1 text-xs text-slate-500">ทะเบียนการครอบครองทรัพย์สินพนักงาน</p></div>
        <Badge variant={statusTone[assignment.status]}>{assignment.status}</Badge>
      </div>
      <dl className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-700">
        {details.map(([label, value]) => <div key={label} className="bg-white p-3 dark:bg-slate-800"><dt className="text-[11px] font-semibold text-slate-400">{label}</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-200">{value}</dd></div>)}
      </dl>
      {assignment.asset && <div className="mt-4 text-right"><Link to={`/assets/${assignment.asset.id}`} className="text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300">ดูทะเบียน Asset →</Link></div>}
    </div>
  );
}

export function EmployeeAssignmentsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const table = useTableParams<'employeeId' | 'status' | 'search'>({ filters: ['employeeId', 'status', 'search'] });
  const { page, pageSize } = table;
  const { employeeId, status, search } = table.filters;
  const debouncedSearch = useDebouncedValue(search);
  const [viewingAssignment, setViewingAssignment] = useState<EmployeeAssignment | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<EmployeeAssignment | null>(null);
  const [bulkMode, setBulkMode] = useState<'assign' | 'return' | null>(null);

  const employeesQuery = useQuery({ queryKey: ['employee-options'], queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options') });
  const returnEmployeesQuery = useQuery({ queryKey: ['employee-return-options'], queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employee-assignments/return-options') });
  const assetsQuery = useQuery({ queryKey: ['asset-options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options') });
  const assignmentsQuery = useQuery({
    queryKey: ['employee-assignments', page, pageSize, employeeId, status, debouncedSearch],
    queryFn: () =>
      apiFetch<PaginatedResult<EmployeeAssignment>>(
        `/api/v1/employee-assignments?page=${page}&pageSize=${pageSize}${employeeId ? `&employeeId=${employeeId}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`,
      ),
  });

  const employees = employeesQuery.data ?? [];
  const returnEmployees = returnEmployeesQuery.data ?? [];
  const items = assignmentsQuery.data?.items ?? [];
  const totalItems = assignmentsQuery.data?.pagination.totalItems ?? 0;
  const activeFilterCount = [employeeId, status, search].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-5" data-testid="employee-assignments-page">
      <PageHeader
        eyebrow="ทรัพย์สินและโครงสร้างพื้นฐาน / เบิกจ่ายทรัพย์สิน"
        title="เบิกจ่าย / คืนทรัพย์สินพนักงาน"
        description="แยก Owner / Custodian / ผู้ใช้งาน พร้อมวันที่เบิก-คืน เอกสารรับมอบ Accessories และ Manager approval"
        primaryAction={<RequirePermission permission="employee.manage"><Button size="sm" onClick={() => setBulkMode('assign')} data-testid="employee-assignment-bulk-assign">Bulk Assign</Button></RequirePermission>}
        secondaryActions={<div className="flex flex-wrap gap-2"><RequirePermission permission="employee.manage"><Button size="sm" variant="outline" onClick={() => setBulkMode('return')} data-testid="employee-assignment-bulk-return">Bulk Return</Button></RequirePermission><RequirePermission permission="employee.manage"><Button size="sm" variant="outline" onClick={() => navigate('/admin/employees')} data-testid="ea-go-employees">ไปหน้าพนักงานเพื่อเพิ่มรายการ<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button></RequirePermission></div>}
      />

      <KpiStrip items={[
        { key: 'all', label: 'รายการในระบบ', value: totalItems, tone: 'primary', icon: <Laptop2 className="h-5 w-5" />, active: !status, onClick: () => table.setFilter('status', '') },
        { key: 'owned', label: 'กำลังครอบครอง', value: items.filter((item) => item.status === 'ครอบครอง').length, note: 'ในหน้าปัจจุบัน', tone: 'teal', icon: <PackageCheck className="h-5 w-5" />, active: status === 'ครอบครอง', onClick: () => table.setFilter('status', status === 'ครอบครอง' ? '' : 'ครอบครอง') },
        { key: 'repair', label: 'อยู่ระหว่างส่งซ่อม', value: items.filter((item) => item.status === 'ส่งซ่อม').length, note: 'ในหน้าปัจจุบัน', tone: 'amber', icon: <Wrench className="h-5 w-5" />, active: status === 'ส่งซ่อม', onClick: () => table.setFilter('status', status === 'ส่งซ่อม' ? '' : 'ส่งซ่อม') },
        { key: 'lost', label: 'แจ้งสูญหาย', value: items.filter((item) => item.status === 'สูญหาย').length, note: 'ในหน้าปัจจุบัน', tone: 'danger', icon: <AlertTriangle className="h-5 w-5" />, active: status === 'สูญหาย', onClick: () => table.setFilter('status', status === 'สูญหาย' ? '' : 'สูญหาย') },
      ]} />

      <div className="rounded-lg border border-primary-200 bg-primary-50/70 px-4 py-3 text-sm text-primary-800 dark:border-primary-900/60 dark:bg-primary-950/30 dark:text-primary-200">
        ใช้ Bulk Assign สำหรับพนักงานใหม่ และ Bulk Return เมื่อพนักงานพ้นสภาพได้จากหน้านี้ ส่วนรายการเดิมยังดูประวัติและแก้ไขสถานะได้จากตาราง
      </div>

      <Card className="overflow-hidden">
        <div className="p-3">
          <FilterBar
            className="border-0 bg-surface-header shadow-none dark:bg-white/[.028]"
            searchValue={search}
            onSearchChange={(value) => table.setFilter('search', value, { replace: true })}
            searchPlaceholder="ค้นหารายการ รหัสทรัพย์สิน หรือ Serial Number..."
            filters={<>
            <select aria-label="กรองพนักงาน" value={employeeId} onChange={(e) => table.setFilter('employeeId', e.target.value)} className={filterControlClass}>
              <option value="">ทุกพนักงาน</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{[e.prefix_th, e.first_name_th, e.last_name_th].filter(Boolean).join(' ')}</option>
              ))}
            </select>
            <select aria-label="กรองสถานะ" value={status} onChange={(e) => table.setFilter('status', e.target.value)} className={filterControlClass}>
              <option value="">ทุกสถานะ</option>
              {EMPLOYEE_ASSIGNMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            </>}
            onClear={table.reset}
            activeFilterCount={activeFilterCount}
            resultCount={totalItems}
            actions={<ExportCsvButton disabled={items.length === 0} fileName={`employee-assignments-page-${page}.csv`} getRows={() => [
              ['รายการ', 'หมวดหมู่', 'พนักงาน', 'รหัสทรัพย์สิน', 'Serial Number', 'สถานะ', 'วันที่รับ', 'วันที่คืน'],
              ...items.map((item) => [item.item_name, item.category, item.employee ? `${item.employee.first_name_th} ${item.employee.last_name_th}` : '', item.asset?.asset_code ?? item.asset_code ?? '', item.serial_number ?? '', item.status, item.assigned_date ?? '', item.returned_date ?? '']),
            ]} />}
          />
        </div>

          {assignmentsQuery.isLoading && (
            <div className="flex min-h-64 justify-center py-20" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}
          {assignmentsQuery.data && items.length === 0 && <div className="min-h-72"><EmptyState icon={<Laptop2 className="h-10 w-10" aria-hidden="true" />} title="ไม่พบรายการครอบครอง" message="ลองเปลี่ยนตัวกรอง หรือเพิ่มรายการจากหน้าพนักงาน" /></div>}

          {items.length > 0 && <DataTable mode="server" toolbar={false} pagination={false} currentPageExport={false} tableId="employee-assignments" rowNumberStart={(page - 1) * pageSize + 1} cardOnMobile containerClassName="rounded-none border-x-0 shadow-none" className="min-w-[900px]">
            <thead><tr><th>รายการ / รหัส</th><th>พนักงาน / ผู้ใช้งาน</th><th>Owner / Custodian</th><th>วันที่เบิก / คืน</th><th>Approval / เอกสาร</th><th>สถานะ</th><th className="text-right">จัดการ</th></tr></thead>
            <tbody>{items.map((assignment) => <tr key={assignment.id} data-testid={`ea-row-${assignment.id}`}>
              <td data-label="รายการ / รหัส"><p className="font-semibold text-slate-800 dark:text-slate-100">{assignment.item_name}</p><p className="mt-0.5 font-mono text-[11px] text-slate-400">{assignment.asset?.asset_code ?? assignment.asset_code ?? assignment.serial_number ?? '—'}</p></td>
              <td data-label="พนักงาน / ผู้ใช้งาน">{(assignment.assigned_user ?? assignment.employee) ? <><p>{(assignment.assigned_user ?? assignment.employee)?.first_name_th} {(assignment.assigned_user ?? assignment.employee)?.last_name_th}</p><p className="text-xs text-slate-400">{(assignment.assigned_user ?? assignment.employee)?.employee_code}</p></> : '—'}</td>
              <td data-label="Owner / Custodian" className="text-slate-500"><p>O: {assignment.owner ? `${assignment.owner.first_name_th} ${assignment.owner.last_name_th}` : 'องค์กร'}</p><p className="text-xs">C: {assignment.custodian ? `${assignment.custodian.first_name_th} ${assignment.custodian.last_name_th}` : '—'}</p></td>
              <td data-label="วันที่เบิก / คืน" className="text-slate-500"><p>{assignment.checkout_date || assignment.assigned_date ? formatThaiDate(assignment.checkout_date ?? assignment.assigned_date!, 'd MMM yyyy') : '—'}</p>{(assignment.return_date || assignment.returned_date) && <p className="text-xs text-slate-400">คืน {formatThaiDate(assignment.return_date ?? assignment.returned_date!, 'd MMM yyyy')}</p>}</td>
              <td data-label="Approval / เอกสาร" className="text-slate-500"><p>{assignment.manager_approval_status === 'approved' ? 'อนุมัติแล้ว' : assignment.manager_approval_status}</p><p className="max-w-36 truncate text-xs">{assignment.handover_document_name ?? 'ไม่มีเอกสาร'}</p></td>
              <td data-label="สถานะ"><Badge variant={statusTone[assignment.status]}>{assignment.status}</Badge></td>
              <td data-label="จัดการ" className="text-right"><RowActions recordLabel={assignment.item_name} actions={[
                { kind: 'view', onClick: () => setViewingAssignment(assignment) },
                { kind: 'edit', permission: 'employee.manage', onClick: () => setEditingAssignment(assignment) },
                { kind: 'delete', permission: 'employee.manage', deleteEndpoint: `/api/v1/record-deletions/employee-assignments/${assignment.id}` },
              ]} /></td>
            </tr>)}</tbody>
          </DataTable>}

          <div className="px-4 pb-4"><TablePagination page={assignmentsQuery.data?.pagination.page ?? page} pageSize={pageSize} totalItems={totalItems} totalPages={assignmentsQuery.data?.pagination.totalPages} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} /></div>
      </Card>

      {viewingAssignment && <Modal title="ดูรายละเอียดการครอบครอง" size="lg" onClose={() => setViewingAssignment(null)}><AssignmentDetail assignment={viewingAssignment} /></Modal>}
      {editingAssignment && <Modal title="แก้ไขสถานะการครอบครอง" size="sm" onClose={() => setEditingAssignment(null)}><AssignmentStatusControl key={editingAssignment.id} assignment={editingAssignment} onSaved={() => setEditingAssignment(null)} /></Modal>}
      {bulkMode && <EmployeeAssignmentBulkModal mode={bulkMode} employees={bulkMode === 'return' ? returnEmployees : employees} assets={assetsQuery.data ?? []} onClose={() => setBulkMode(null)} onSaved={() => { setBulkMode(null); void assignmentsQuery.refetch(); void assetsQuery.refetch(); void returnEmployeesQuery.refetch(); void queryClient.invalidateQueries({ queryKey: ['admin', 'employees-overview'] }); }} />}
    </div>
  );
}
