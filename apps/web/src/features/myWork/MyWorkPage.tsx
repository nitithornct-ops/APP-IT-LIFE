import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckSquare2, ClipboardCheck, Clock3, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../../components/table/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { QueryError } from '../../components/ui/QueryError';
import { apiFetch } from '../../services/apiClient';
import type { MyWorkItem, MyWorkResponse } from '../../types/dashboard';
import { formatThaiDate } from '../../utils/date';

type Scope = 'all' | 'approval' | 'assigned' | 'personal';

const approvalKinds = new Set<MyWorkItem['kind']>(['service_approval', 'access_approval', 'workflow_approval']);
const assignedKinds = new Set<MyWorkItem['kind']>(['ticket', 'service_request', 'access_fulfillment']);

function dueState(dueAt: string | null) {
  if (!dueAt) return { label: 'ไม่มีกำหนด', overdue: false };
  const overdue = new Date(dueAt).getTime() < Date.now();
  return { label: formatThaiDate(dueAt, dueAt.length === 10 ? 'd MMM yyyy' : 'd MMM yyyy HH:mm'), overdue };
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <Card><CardBody className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200">{icon}</span><div><p className="text-2xl font-extrabold text-slate-900 dark:text-white">{value.toLocaleString('th-TH')}</p><p className="text-xs text-slate-500">{label}</p></div></CardBody></Card>;
}

export function MyWorkPage() {
  const [scope, setScope] = useState<Scope>('all');
  const query = useQuery({
    queryKey: ['my-work'],
    queryFn: () => apiFetch<MyWorkResponse>('/api/v1/dashboard/my-work'),
    refetchInterval: 60_000,
  });
  const items = useMemo(() => (query.data?.items ?? []).filter((item) => {
    if (scope === 'approval') return approvalKinds.has(item.kind);
    if (scope === 'assigned') return assignedKinds.has(item.kind);
    if (scope === 'personal') return item.kind === 'task';
    return true;
  }), [query.data?.items, scope]);

  return (
    <div className="space-y-5" data-testid="my-work-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-widest text-primary-600">Unified inbox</p><h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">ศูนย์งานของฉัน</h1><p className="mt-1 text-sm text-slate-500">รวมงานที่ได้รับมอบหมาย งานอนุมัติ และงานส่วนตัวที่ต้องลงมือทำ</p></div>
        <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />รีเฟรช</Button>
      </div>

      {query.isLoading && <div className="flex justify-center py-20" role="status"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>}
      {query.isError && <QueryError title="โหลดศูนย์งานไม่สำเร็จ" error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}
      {query.data && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="ทั้งหมด" value={query.data.summary.total} icon={<Inbox className="h-5 w-5" />} />
          <SummaryCard label="เกินกำหนด" value={query.data.summary.overdue} icon={<AlertTriangle className="h-5 w-5" />} />
          <SummaryCard label="รอพิจารณา" value={query.data.summary.approvals} icon={<ClipboardCheck className="h-5 w-5" />} />
          <SummaryCard label="ได้รับมอบหมาย" value={query.data.summary.assigned} icon={<CheckSquare2 className="h-5 w-5" />} />
        </div>

        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3"><span>รายการที่ต้องดำเนินการ</span><div className="flex flex-wrap gap-1">{([
            ['all', 'ทั้งหมด'], ['approval', 'งานอนุมัติ'], ['assigned', 'งานมอบหมาย'], ['personal', 'งานส่วนตัว'],
          ] as Array<[Scope, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => setScope(value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${scope === value ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{label}</button>)}</div></CardHeader>
          {items.length ? <div className="overflow-x-auto"><DataTable className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40"><tr><th className="px-5 py-3">แหล่งงาน</th><th className="px-5 py-3">รายการ</th><th className="px-5 py-3">สถานะ</th><th className="px-5 py-3">กำหนด</th><th className="px-5 py-3 text-right">ดำเนินการ</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{items.map((item) => { const due = dueState(item.dueAt); return <tr key={`${item.kind}-${item.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/30"><td className="whitespace-nowrap px-5 py-3"><Badge variant={approvalKinds.has(item.kind) ? 'warning' : item.kind === 'task' ? 'secondary' : 'info'}>{item.source}</Badge></td><td className="max-w-[460px] px-5 py-3 font-semibold text-slate-800 dark:text-slate-100">{item.title}</td><td className="whitespace-nowrap px-5 py-3 text-slate-500">{item.status}</td><td className={`whitespace-nowrap px-5 py-3 ${due.overdue ? 'font-bold text-red-600' : 'text-slate-500'}`}><span className="inline-flex items-center gap-1"><Clock3 className="h-4 w-4" />{due.label}</span></td><td className="whitespace-nowrap px-5 py-3 text-right"><Link className="font-semibold text-primary-700 hover:underline dark:text-primary-300" to={item.path}>{item.action}</Link></td></tr>; })}</tbody></DataTable></div> : <EmptyState icon={<Inbox className="h-9 w-9" />} title="ไม่มีงานในมุมมองนี้" message="เมื่อมีงานมอบหมายหรือรายการรออนุมัติ ระบบจะแสดงที่นี่อัตโนมัติ" />}
        </Card>
      </>}
    </div>
  );
}
