import { DataTable, TablePagination } from '../../components/table/DataTable';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Grid3X3, Loader2, Plus, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { QueryError } from '../../components/ui/QueryError';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { PaginatedResult } from '../../types/admin';
import { INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, INCIDENT_STATUSES, type Incident, type RiskMatrixCell } from '../../types/incidents';
import { formatThaiDate } from '../../utils/date';
import { incidentStatusTone, riskCellClass, riskTone } from './incidentDisplay';

const createSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อ').max(200),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(3000),
  category: z.enum(INCIDENT_CATEGORIES),
  affectedSystem: z.string().trim().max(150).optional(),
  containsPersonalData: z.boolean().optional(),
  evidenceUrl: z.union([z.string().trim().url('URL ไม่ถูกต้อง'), z.literal('')]).optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function CreateIncidentForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { category: INCIDENT_CATEGORIES[0], containsPersonalData: false },
  });
  const mutation = useMutation({
    mutationFn: (values: CreateForm) => apiFetch<Incident>('/api/v1/incidents', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['incidents'] }); onClose(); },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'บันทึก Incident ไม่สำเร็จ'),
  });
  const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
  return (
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40" noValidate data-testid="incident-create-form">
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="font-bold text-slate-800 dark:text-slate-100">รับแจ้งเหตุการณ์</h3>
        <button type="button" onClick={onClose} aria-label="ปิด"><X className="h-4 w-4" /></button>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="incident-title" className="mb-1 block text-xs font-semibold">หัวข้อ</label>
        <input id="incident-title" data-testid="incident-create-title" className={fieldClass} {...register('title')} />
        {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
      </div>
      <div>
        <label htmlFor="incident-category" className="mb-1 block text-xs font-semibold">ประเภทเหตุการณ์</label>
        <select id="incident-category" data-testid="incident-create-category" className={fieldClass} {...register('category')}>
          {INCIDENT_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="incident-system" className="mb-1 block text-xs font-semibold">ระบบที่ได้รับผลกระทบ</label>
        <input id="incident-system" className={fieldClass} {...register('affectedSystem')} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="incident-description" className="mb-1 block text-xs font-semibold">รายละเอียด</label>
        <textarea id="incident-description" data-testid="incident-create-description" rows={4} className={fieldClass} {...register('description')} />
        {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
      </div>
      <div>
        <label htmlFor="incident-evidence" className="mb-1 block text-xs font-semibold">ลิงก์หลักฐาน (ถ้ามี)</label>
        <input id="incident-evidence" type="url" className={fieldClass} {...register('evidenceUrl')} />
      </div>
      <label className="flex items-center gap-2 self-end rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
        <input type="checkbox" data-testid="incident-create-pii" {...register('containsPersonalData')} />
        เกี่ยวข้องกับข้อมูลส่วนบุคคล
      </label>
      {serverError && <p className="text-sm text-red-600 sm:col-span-2">{serverError}</p>}
      <div className="sm:col-span-2"><Button type="submit" size="sm" isLoading={isSubmitting || mutation.isPending} data-testid="incident-create-submit">บันทึกการแจ้งเหตุ</Button></div>
    </form>
  );
}
function RiskMatrix() {
  const query = useQuery({ queryKey: ['incidents', 'matrix'], queryFn: () => apiFetch<RiskMatrixCell[]>('/api/v1/incidents/matrix') });
  if (!query.data) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const byCell = new Map(query.data.map((cell) => [`${cell.likelihood}-${cell.impact}`, cell]));
  return (
    <Card data-testid="incident-risk-matrix">
      <CardHeader className="flex items-center gap-2"><Grid3X3 className="h-4 w-4" /> Risk Matrix 5×5 — เคสที่ยังเปิด</CardHeader>
      <CardBody>
        <div className="grid min-w-[520px] grid-cols-6 gap-1 overflow-x-auto text-center text-xs">
          <div className="p-2 font-bold">L \ I</div>
          {[1, 2, 3, 4, 5].map((impact) => <div key={impact} className="p-2 font-bold">{impact}</div>)}
          {[5, 4, 3, 2, 1].map((likelihood) => [
            <div key={`l-${likelihood}`} className="p-2 font-bold">{likelihood}</div>,
            ...[1, 2, 3, 4, 5].map((impact) => {
              const cell = byCell.get(`${likelihood}-${impact}`)!;
              return <div key={`${likelihood}-${impact}`} className={`rounded p-2 ${riskCellClass(cell.score)}`} title={`${cell.riskLevel}: ${cell.score}`}><b>{cell.score}</b><span className="ml-1 opacity-70">({cell.count})</span></div>;
            }),
          ])}
        </div>
      </CardBody>
    </Card>
  );
}

export function IncidentsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [personalData, setPersonalData] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const debouncedSearch = useDebouncedValue(search);
  const query = useQuery({
    queryKey: ['incidents', page, pageSize, status, severity, personalData, debouncedSearch],
    queryFn: () => apiFetch<PaginatedResult<Incident>>(`/api/v1/incidents?page=${page}&pageSize=${pageSize}${status ? `&status=${encodeURIComponent(status)}` : ''}${severity ? `&severity=${encodeURIComponent(severity)}` : ''}${personalData ? `&personalData=${personalData}` : ''}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`),
  });
  const items = query.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4" data-testid="incidents-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Incident Management</h1><p className="text-sm text-slate-500">รับแจ้ง ประเมินความเสี่ยง ตอบสนอง และกำกับการแจ้งภายนอก</p></div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowMatrix((value) => !value)}><Grid3X3 className="h-4 w-4" /> Risk Matrix</Button>
          <RequirePermission permission="incident.create"><Button size="sm" onClick={() => setShowCreate((value) => !value)} data-testid="incident-create-toggle"><Plus className="h-4 w-4" /> แจ้งเหตุ</Button></RequirePermission>
        </div>
      </div>
      {showCreate && <FormModal title="แจ้ง Incident" description="บันทึกเหตุการณ์ ประเมินความรุนแรง และข้อมูลที่เกี่ยวข้อง" size="lg" onClose={() => setShowCreate(false)}><CreateIncidentForm onClose={() => setShowCreate(false)} /></FormModal>}
      {showMatrix && <RiskMatrix />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="ทั้งหมด" value={query.data?.pagination.totalItems ?? 0} tone="primary" />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="เปิด (หน้านี้)" value={items.filter((item) => item.status === 'เปิด').length} tone="danger" />
        <StatCard icon={<ShieldAlert className="h-5 w-5" />} label="เกี่ยวข้อง PDPA" value={items.filter((item) => item.contains_personal_data).length} tone="amber" />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Risk สูง/วิกฤต" value={items.filter((item) => item.risk_level === 'สูง' || item.risk_level === 'วิกฤต').length} tone="gray" />
      </div>
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span>รายการ Incident</span><div className="flex flex-wrap gap-2 text-xs font-normal">
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-full border px-3 py-1 dark:bg-slate-900"><option value="">ทุกสถานะ</option>{INCIDENT_STATUSES.map((value) => <option key={value}>{value}</option>)}</select>
          <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} className="rounded-full border px-3 py-1 dark:bg-slate-900"><option value="">ทุกความรุนแรง</option>{INCIDENT_SEVERITIES.map((value) => <option key={value}>{value}</option>)}</select>
          <select value={personalData} onChange={(e) => { setPersonalData(e.target.value); setPage(1); }} className="rounded-full border px-3 py-1 dark:bg-slate-900"><option value="">ทุกประเภทข้อมูล</option><option value="true">ข้อมูลส่วนบุคคล</option><option value="false">ไม่ใช่ข้อมูลส่วนบุคคล</option></select>
        </div></CardHeader>
        <CardBody>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="ค้นหาเลข Incident หรือหัวข้อ..." className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
            <ExportCsvButton
              disabled={!items.length}
              fileName={`incidents-page-${page}.csv`}
              getRows={() => [
                ['เลขที่', 'วันที่แจ้ง', 'เหตุการณ์', 'หมวด', 'ความรุนแรง', 'Risk', 'Risk Score', 'ข้อมูลส่วนบุคคล', 'ผู้รับผิดชอบ', 'สถานะ'],
                ...items.map((item) => [
                  item.incident_number,
                  formatThaiDate(item.report_date, 'd MMM yyyy HH:mm'),
                  item.title,
                  item.category,
                  item.severity ?? 'ยังไม่จำแนก',
                  item.risk_level ?? '',
                  item.risk_score ?? '',
                  item.contains_personal_data ? 'ใช่' : 'ไม่ใช่',
                  item.assignee?.full_name ?? '',
                  item.status,
                ]),
              ]}
            />
          </div>
          {query.isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {query.isError && (
            <QueryError title="โหลดรายการ Incident ไม่สำเร็จ" error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
          )}
          {!query.isError && query.data && items.length === 0 && <EmptyState icon={<AlertTriangle className="h-10 w-10" />} title="ไม่พบ Incident" />}
          {items.length > 0 && <div className="overflow-x-auto"><DataTable mode="server" className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="px-2 py-2">เลขที่</th><th className="px-2 py-2">เหตุการณ์</th><th className="px-2 py-2">ความรุนแรง/Risk</th><th className="px-2 py-2">PDPA</th><th className="px-2 py-2">ผู้รับผิดชอบ</th><th className="px-2 py-2">สถานะ</th><th className="px-2 py-2 text-right">ดำเนินการ</th></tr></thead><tbody>
            {items.map((item) => <tr key={item.id} data-testid={`incident-row-${item.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="px-2 py-2"><Link to={`/incidents/${item.id}`} className="font-mono text-xs text-primary-700 hover:underline dark:text-primary-300">{item.incident_number}</Link><p className="text-xs text-slate-400">{formatThaiDate(item.report_date, 'd MMM yyyy HH:mm')}</p></td><td className="px-2 py-2"><Link to={`/incidents/${item.id}`} className="font-medium hover:underline">{item.title}</Link><p className="text-xs text-slate-400">{item.category}</p></td><td className="px-2 py-2"><div className="flex gap-1"><Badge variant={item.severity ? riskTone[item.severity] : 'secondary'}>{item.severity ?? 'ยังไม่จำแนก'}</Badge>{item.risk_level && <Badge variant={riskTone[item.risk_level]}>Risk {item.risk_level} ({item.risk_score})</Badge>}</div></td><td className="px-2 py-2">{item.contains_personal_data ? <Badge variant="danger">PII</Badge> : '—'}</td><td className="px-2 py-2 text-slate-500">{item.assignee?.full_name ?? '—'}</td><td className="px-2 py-2"><Badge variant={incidentStatusTone[item.status]}>{item.status}</Badge></td><td className="px-2 py-2 text-right"><RowActions recordLabel={item.incident_number} actions={[{ kind: 'view', to: `/incidents/${item.id}` }]} /></td></tr>)}
          </tbody></DataTable></div>}
          {query.data && <TablePagination page={query.data.pagination.page} pageSize={pageSize} totalItems={query.data.pagination.totalItems} totalPages={query.data.pagination.totalPages} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
        </CardBody>
      </Card>
    </div>
  );
}
