import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { RowActions } from '../../components/table/RowActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeftRight, CalendarClock, CheckCircle2, History, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FilterBar, filterControlClass } from '../../components/ui/FilterBar';
import { KpiStrip } from '../../components/ui/KpiStrip';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Department, EmployeeOption, PaginatedResult } from '../../types/admin';
import type { ActiveAssetLoan, AssetBorrowMovement, AssetBorrowSummary, AssetOption } from '../../types/assets';
import { formatThaiDate } from '../../utils/date';

type BorrowView = 'active' | 'history';
type MovementAction = 'assign' | 'return' | 'transfer';
type OverviewRecord = ActiveAssetLoan | AssetBorrowMovement;

interface BorrowOverviewResponse {
  summary: AssetBorrowSummary;
  records: PaginatedResult<OverviewRecord>;
}

const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';

function isHistoryRecord(item: OverviewRecord): item is AssetBorrowMovement {
  return 'action_type' in item;
}

function fullName(person: { first_name_th: string; last_name_th: string } | null | undefined) {
  return person ? `${person.first_name_th} ${person.last_name_th}` : '—';
}

function dueState(dueDate: string | null) {
  if (!dueDate) return { label: 'ไม่กำหนด', variant: 'secondary' as const };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `เกินกำหนด ${Math.abs(days)} วัน`, variant: 'danger' as const };
  if (days <= 7) return { label: days === 0 ? 'ครบกำหนดวันนี้' : `เหลือ ${days} วัน`, variant: 'warning' as const };
  return { label: formatThaiDate(dueDate, 'd MMM yyyy'), variant: 'secondary' as const };
}

function MovementModal({
  assets,
  employees,
  departments,
  onClose,
}: {
  assets: AssetOption[];
  employees: EmployeeOption[];
  departments: Department[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<MovementAction>('assign');
  const [assetId, setAssetId] = useState('');
  const [toEmployeeId, setToEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [location, setLocation] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');

  const eligibleAssets = assets.filter((asset) => {
    if (action === 'assign') return asset.status === 'พร้อมใช้งาน';
    return asset.status === 'ใช้งานอยู่';
  });

  const mutation = useMutation({
    mutationFn: () => {
      const common = { location: location || undefined, notes: notes || undefined };
      if (action === 'return') {
        return apiFetch(`/api/v1/assets/${assetId}/return`, {
          method: 'POST',
          body: JSON.stringify({ ...common, condition: condition || undefined }),
        });
      }
      const body = {
        ...common,
        toEmployeeId: toEmployeeId || undefined,
        departmentId: departmentId || undefined,
        dueDate: dueDate || undefined,
      };
      return apiFetch(`/api/v1/assets/${assetId}/${action}`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset-borrow'] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['asset-options'] }),
      ]);
      onClose();
    },
  });

  const canSubmit = Boolean(
    assetId &&
      (action === 'return' ||
        (action === 'assign' && toEmployeeId) ||
        (action === 'transfer' && (toEmployeeId || departmentId || location))),
  );

  return (
    <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2" data-testid="asset-borrow-movement-form">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">การดำเนินการ *</label>
        <select
          className={fieldClass}
          value={action}
          onChange={(event) => {
            setAction(event.target.value as MovementAction);
            setAssetId('');
          }}
        >
          <option value="assign">ยืม / มอบหมาย</option>
          <option value="return">คืน</option>
          <option value="transfer">โอนย้าย</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Asset *</label>
        <select className={fieldClass} value={assetId} onChange={(event) => setAssetId(event.target.value)} data-testid="asset-borrow-asset">
          <option value="">— เลือก —</option>
          {eligibleAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} — {asset.name}</option>)}
        </select>
        {eligibleAssets.length === 0 && <p className="mt-1 text-xs text-amber-600">ไม่มี Asset ที่พร้อมสำหรับรายการนี้</p>}
      </div>

      {action !== 'return' && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้รับ/ผู้ถือครอง{action === 'assign' ? ' *' : ''}</label>
          <select className={fieldClass} value={toEmployeeId} onChange={(event) => setToEmployeeId(event.target.value)}>
            <option value="">— เลือกพนักงาน —</option>
            {employees.filter((employee) => employee.status === 'active').map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.employee_code} — {[employee.prefix_th, employee.first_name_th, employee.last_name_th].filter(Boolean).join(' ')}</option>
            ))}
          </select>
        </div>
      )}

      {action !== 'return' && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">แผนก</label>
          <select className={fieldClass} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">— ไม่ระบุ —</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name_th}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{action === 'return' ? 'สถานที่รับคืน' : 'สถานที่'}</label>
        <input className={fieldClass} value={location} onChange={(event) => setLocation(event.target.value)} placeholder={action === 'return' ? 'คลัง IT' : undefined} />
      </div>
      {action !== 'return' ? (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">กำหนดคืน</label>
          <input type="date" className={fieldClass} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </div>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สภาพตอนคืน</label>
          <input className={fieldClass} value={condition} onChange={(event) => setCondition(event.target.value)} />
        </div>
      )}
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <textarea rows={3} className={fieldClass} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      {mutation.error && <p className="text-xs text-red-600 sm:col-span-2">{mutation.error instanceof ApiError ? mutation.error.message : 'บันทึกรายการไม่สำเร็จ'}</p>}
      <div className="-mx-5 -mb-5 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:col-span-2 dark:border-slate-700 dark:bg-slate-900/40">
        <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
        <Button size="sm" disabled={!canSubmit} isLoading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="asset-borrow-submit">บันทึก</Button>
      </div>
    </div>
  );
}

export function AssetBorrowPage() {
  const table = useTableParams<'view' | 'search' | 'departmentId'>({ filters: ['view', 'search', 'departmentId'] });
  const { page, pageSize } = table;
  const { search, departmentId } = table.filters;
  const view: BorrowView = table.filters.view === 'history' ? 'history' : 'active';
  const [showMovement, setShowMovement] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const overviewQuery = useQuery({
    queryKey: ['asset-borrow', view, page, pageSize, debouncedSearch, departmentId],
    queryFn: () => apiFetch<BorrowOverviewResponse>(`/api/v1/assets/borrow-overview?view=${view}&page=${page}&pageSize=${pageSize}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}${departmentId ? `&departmentId=${departmentId}` : ''}`),
  });
  const assetsQuery = useQuery({ queryKey: ['asset-options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options') });
  const employeesQuery = useQuery({ queryKey: ['employee-options'], queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options') });
  const departmentsQuery = useQuery({ queryKey: ['admin', 'departments'], queryFn: () => apiFetch<Department[]>('/api/v1/departments') });

  const summary = overviewQuery.data?.summary ?? { available: 0, active: 0, dueSoon: 0, overdue: 0 };
  const records = overviewQuery.data?.records;
  const activeRecords = records?.items.filter((item): item is ActiveAssetLoan => !isHistoryRecord(item)) ?? [];
  const historyRecords = records?.items.filter(isHistoryRecord) ?? [];
  const activeFilterCount = [search, departmentId].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-5" data-testid="asset-borrow-page">
      <PageHeader
        eyebrow="ทรัพย์สินและโครงสร้างพื้นฐาน / ยืม-คืน Asset"
        title="ยืม / คืน / โอนย้าย Asset"
        description="ติดตามผู้ถือครอง กำหนดคืน และประวัติการเคลื่อนไหวทรัพย์สิน"
        primaryAction={<RequirePermission permission="asset.transfer"><Button size="sm" onClick={() => setShowMovement(true)} data-testid="asset-borrow-create" aria-haspopup="dialog"><Plus className="h-4 w-4" />บันทึกการเคลื่อนไหว</Button></RequirePermission>}
      />

      <KpiStrip items={[
        { key: 'available', label: 'พร้อมให้ยืม', value: summary.available, tone: 'teal', icon: <CheckCircle2 className="h-5 w-5" /> },
        { key: 'active', label: 'กำลังถือครอง', value: summary.active, tone: 'gray', icon: <ArrowLeftRight className="h-5 w-5" />, active: view === 'active', onClick: () => table.setFilter('view', '') },
        { key: 'due-soon', label: 'ใกล้ครบกำหนดคืน', value: summary.dueSoon, tone: 'amber', icon: <CalendarClock className="h-5 w-5" /> },
        { key: 'overdue', label: 'ค้างคืน (เกินกำหนด)', value: summary.overdue, tone: 'danger', icon: <AlertTriangle className="h-5 w-5" /> },
      ]} />

      <div className="flex border-b border-slate-200 dark:border-slate-700">
        <button type="button" onClick={() => table.setFilter('view', '')} className={`flex h-12 items-center gap-2 border-b-2 px-4 text-sm font-semibold ${view === 'active' ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500'}`}><ArrowLeftRight className="h-4 w-4" />กำลังถือครอง / ค้างคืน ({summary.active})</button>
        <button type="button" onClick={() => table.setFilter('view', 'history')} className={`flex h-12 items-center gap-2 border-b-2 px-4 text-sm font-semibold ${view === 'history' ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500'}`}><History className="h-4 w-4" />ประวัติเคลื่อนไหว</button>
      </div>

      <Card className="overflow-hidden">
          <div className="p-3">
            <FilterBar
              className="border-0 bg-surface-header shadow-none dark:bg-white/[.028]"
              searchValue={search}
              onSearchChange={(value) => table.setFilter('search', value, { replace: true })}
              searchPlaceholder="ค้นหา Asset ผู้ถือครอง หรือรหัสพนักงาน..."
              filters={<select aria-label="กรองแผนก" value={departmentId} onChange={(event) => table.setFilter('departmentId', event.target.value)} className={filterControlClass}><option value="">แผนก: ทั้งหมด</option>{(departmentsQuery.data ?? []).map((department) => <option key={department.id} value={department.id}>{department.name_th}</option>)}</select>}
              onClear={() => table.setFilters({ search: '', departmentId: '' })}
              activeFilterCount={activeFilterCount}
              resultCount={records?.pagination.totalItems}
              actions={<ExportCsvButton
              className="self-center"
              disabled={view === 'active' ? !activeRecords.length : !historyRecords.length}
              fileName={`asset-${view === 'active' ? 'loans' : 'movements'}-page-${page}.csv`}
              getRows={() => (view === 'active'
                ? [
                  ['Asset', 'รหัสทรัพย์สิน', 'ผู้ถือครอง', 'รหัสพนักงาน', 'แผนก', 'สถานที่', 'ยืมเมื่อ', 'กำหนดคืน'],
                  ...activeRecords.map((item) => [
                    item.name,
                    item.asset_code,
                    fullName(item.owner),
                    item.owner?.employee_code ?? '',
                    item.department?.name_th ?? '',
                    item.location ?? '',
                    item.loan_date ? formatThaiDate(item.loan_date, 'd MMM yyyy') : '',
                    item.loan_due_date ? formatThaiDate(item.loan_due_date, 'd MMM yyyy') : '',
                  ]),
                ]
                : [
                  ['วันเวลา', 'Asset', 'รหัสทรัพย์สิน', 'รายการ', 'จาก', 'ไปยัง', 'แผนก / สถานที่', 'หมายเหตุ'],
                  ...historyRecords.map((item) => [
                    formatThaiDate(item.action_date, 'd MMM yyyy HH:mm'),
                    item.asset?.name ?? '',
                    item.asset?.asset_code ?? '',
                    item.status_label ?? item.action_type,
                    fullName(item.from_employee),
                    fullName(item.to_employee),
                    item.department?.name_th ?? item.location ?? '',
                    item.notes ?? item.condition ?? '',
                  ]),
                ])}
              />}
            />
          </div>

          {overviewQuery.isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {overviewQuery.error && <p className="py-8 text-center text-sm text-red-600">{overviewQuery.error instanceof ApiError ? overviewQuery.error.message : 'โหลดข้อมูลไม่สำเร็จ'}</p>}
          {records && records.items.length === 0 && <EmptyState icon={view === 'active' ? <ArrowLeftRight className="h-10 w-10" /> : <History className="h-10 w-10" />} title={view === 'active' ? 'ไม่มีทรัพย์สินที่ถูกยืมหรือถือครองอยู่' : 'ยังไม่มีประวัติการเคลื่อนไหว'} />}

          {view === 'active' && activeRecords.length > 0 && (
            <DataTable mode="server" toolbar={false} pagination={false} currentPageExport={false} tableId="asset-borrow-active" rowNumberStart={(page - 1) * pageSize + 1} containerClassName="rounded-none border-x-0 shadow-none" className="w-full min-w-[820px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40"><tr><th className="px-3 py-3">Asset</th><th className="px-3 py-3">ผู้ถือครอง</th><th className="px-3 py-3">แผนก / สถานที่</th><th className="px-3 py-3">ยืมเมื่อ</th><th className="px-3 py-3">กำหนดคืน</th><th className="px-3 py-3 text-right">จัดการ</th></tr></thead><tbody>{activeRecords.map((item) => { const due = dueState(item.loan_due_date); return <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-3 py-3"><Link to={`/assets/${item.id}`} className="font-semibold text-primary-700 hover:underline dark:text-primary-300">{item.name}</Link><p className="font-mono text-xs text-slate-400">{item.asset_code}</p></td><td className="px-3 py-3">{fullName(item.owner)}{item.owner?.employee_code && <p className="text-xs text-slate-400">{item.owner.employee_code}</p>}</td><td className="px-3 py-3 text-slate-500">{item.department?.name_th ?? '—'}<p className="text-xs">{item.location ?? ''}</p></td><td className="px-3 py-3 text-slate-500">{item.loan_date ? formatThaiDate(item.loan_date, 'd MMM yyyy') : '—'}</td><td className="px-3 py-3"><Badge variant={due.variant}>{due.label}</Badge></td><td className="px-3 py-3 text-right"><RowActions recordLabel={item.asset_code} actions={[{ kind: 'view', to: `/assets/${item.id}` }]} /></td></tr>; })}</tbody></DataTable>
          )}

          {view === 'history' && historyRecords.length > 0 && (
            <DataTable mode="server" toolbar={false} pagination={false} currentPageExport={false} tableId="asset-borrow-history" rowNumberStart={(page - 1) * pageSize + 1} containerClassName="rounded-none border-x-0 shadow-none" className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40"><tr><th className="px-3 py-3">วันเวลา</th><th className="px-3 py-3">Asset</th><th className="px-3 py-3">รายการ</th><th className="px-3 py-3">จาก</th><th className="px-3 py-3">ไปยัง / แผนก</th><th className="px-3 py-3">หมายเหตุ</th></tr></thead><tbody>{historyRecords.map((item) => <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700"><td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatThaiDate(item.action_date, 'd MMM yyyy HH:mm')}</td><td className="px-3 py-3">{item.asset ? <Link to={`/assets/${item.asset.id}`} className="font-semibold text-primary-700 hover:underline dark:text-primary-300">{item.asset.name}<span className="block font-mono text-xs font-normal text-slate-400">{item.asset.asset_code}</span></Link> : '—'}</td><td className="px-3 py-3"><Badge variant={item.action_type === 'Return' ? 'success' : item.action_type === 'Transfer' ? 'warning' : 'info'}>{item.status_label ?? item.action_type}</Badge></td><td className="px-3 py-3 text-slate-500">{fullName(item.from_employee)}</td><td className="px-3 py-3">{fullName(item.to_employee)}<p className="text-xs text-slate-400">{item.department?.name_th ?? item.location ?? ''}</p></td><td className="max-w-xs px-3 py-3 text-slate-500">{item.notes ?? item.condition ?? '—'}</td></tr>)}</tbody></DataTable>
          )}
          {records && <div className="px-4 pb-4"><TablePagination page={records.pagination.page} pageSize={pageSize} totalItems={records.pagination.totalItems} totalPages={records.pagination.totalPages} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} /></div>}
      </Card>

      {showMovement && (
        <Modal title="บันทึกการเคลื่อนไหว Asset" size="lg" onClose={() => setShowMovement(false)} testId="asset-borrow-dialog">
          <MovementModal assets={assetsQuery.data ?? []} employees={employeesQuery.data ?? []} departments={departmentsQuery.data ?? []} onClose={() => setShowMovement(false)} />
        </Modal>
      )}
    </div>
  );
}
