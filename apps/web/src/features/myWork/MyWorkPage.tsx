import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, CheckSquare2, ClipboardCheck, Clock3, Inbox, RefreshCw, UserRoundCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../../components/table/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { KpiStrip } from '../../components/ui/KpiStrip';
import { LoadingState } from '../../components/ui/AsyncState';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryError } from '../../components/ui/QueryError';
import { apiFetch } from '../../services/apiClient';
import type { MyWorkItem, MyWorkResponse } from '../../types/dashboard';
import { formatThaiDate } from '../../utils/date';
import { cn } from '../../utils/cn';

type Scope = 'all' | 'approval' | 'assigned' | 'personal';

const approvalKinds = new Set<MyWorkItem['kind']>(['service_approval', 'access_approval', 'workflow_approval']);
const assignedKinds = new Set<MyWorkItem['kind']>(['ticket', 'service_request', 'access_fulfillment']);

function dueState(dueAt: string | null) {
  if (!dueAt) return { label: 'ไม่มีกำหนด', overdue: false };
  const overdue = new Date(dueAt).getTime() < Date.now();
  return { label: formatThaiDate(dueAt, dueAt.length === 10 ? 'd MMM yyyy' : 'd MMM yyyy HH:mm'), overdue };
}

function itemTone(item: MyWorkItem): 'warning' | 'info' | 'secondary' | 'purple' {
  if (approvalKinds.has(item.kind)) return 'warning';
  if (item.kind === 'task') return 'secondary';
  if (item.kind === 'access_fulfillment') return 'purple';
  return 'info';
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
  const todayItems = useMemo(() => (query.data?.items ?? [])
    .filter((item) => item.dueAt && new Date(item.dueAt).toDateString() === new Date().toDateString())
    .slice(0, 4), [query.data?.items]);
  const delegatedItems = useMemo(() => (query.data?.items ?? []).filter((item) => assignedKinds.has(item.kind)).slice(0, 3), [query.data?.items]);

  return (
    <div className="space-y-4" data-testid="my-work-page">
      <PageHeader
        eyebrow="พื้นที่ทำงาน / Unified inbox"
        title="ศูนย์งานของฉัน"
        description="รวมงานที่ได้รับมอบหมาย งานอนุมัติ และงานส่วนตัวที่ต้องลงมือทำในหน้าจอเดียว"
        leading={<Inbox className="h-5 w-5" />}
        primaryAction={<Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />รีเฟรช</Button>}
      />

      {query.isLoading && <Card><LoadingState label="กำลังรวบรวมงานของคุณ..." rows={6} /></Card>}
      {query.isError && <QueryError title="โหลดศูนย์งานไม่สำเร็จ" error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}
      {query.data && <>
        <KpiStrip
          label="สรุปงานที่ต้องดำเนินการ"
          items={[
            { key: 'all', label: 'ทั้งหมด', value: query.data.summary.total, note: 'งานทุกประเภท', icon: <Inbox className="h-4 w-4" />, active: scope === 'all', onClick: () => setScope('all') },
            { key: 'overdue', label: 'เกินกำหนด', value: query.data.summary.overdue, note: 'ต้องจัดการก่อน', icon: <AlertTriangle className="h-4 w-4" /> },
            { key: 'approval', label: 'รอพิจารณา', value: query.data.summary.approvals, note: 'อนุมัติได้จากในรายการ', icon: <ClipboardCheck className="h-4 w-4" />, active: scope === 'approval', onClick: () => setScope(scope === 'approval' ? 'all' : 'approval') },
            { key: 'assigned', label: 'มอบหมายให้ฉัน', value: query.data.summary.assigned, note: 'กำลังถืออยู่', icon: <CheckSquare2 className="h-4 w-4" />, active: scope === 'assigned', onClick: () => setScope(scope === 'assigned' ? 'all' : 'assigned') },
          ]}
        />

        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <span>รายการที่ต้องดำเนินการ</span>
              <div className="flex rounded-[8px] bg-surface-muted p-0.5 dark:bg-white/[.07]">
                {([
                  ['all', 'ทั้งหมด'], ['approval', 'งานอนุมัติ'], ['assigned', 'งานมอบหมาย'], ['personal', 'งานส่วนตัว'],
                ] as Array<[Scope, string]>).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setScope(value)} className={cn('rounded-[6px] px-3 py-1.5 text-[11.5px] font-medium text-slate-500', scope === value && 'bg-white font-bold text-primary-700 shadow-sm dark:bg-white/[.1] dark:text-primary-300')}>{label}</button>
                ))}
              </div>
            </CardHeader>
            {items.length ? (
              <DataTable tableId="my-work" toolbar={false} pagination={false} className="min-w-[720px]">
                <thead><tr><th className="w-[132px]">แหล่งงาน</th><th>รายการ</th><th className="w-[148px]">สถานะ</th><th className="w-[128px]">กำหนด</th><th className="w-[112px] text-right">ดำเนินการ</th></tr></thead>
                <tbody>{items.map((item) => {
                  const due = dueState(item.dueAt);
                  return (
                    <tr key={`${item.kind}-${item.id}`} className={cn(due.overdue ? 'shadow-[inset_3px_0_0_#dc2626]' : approvalKinds.has(item.kind) ? 'shadow-[inset_3px_0_0_#d97706]' : 'shadow-[inset_3px_0_0_#1d4ed8]')}>
                      <td className="whitespace-nowrap"><Badge variant={itemTone(item)}>{item.source}</Badge></td>
                      <td className="max-w-[460px]"><p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.title}</p><p className="mt-0.5 font-mono text-[10px] text-slate-400">{item.priority ? `ระดับ ${item.priority}` : 'งานในระบบ'}</p></td>
                      <td className="whitespace-nowrap text-slate-500">{item.status}</td>
                      <td className={cn('whitespace-nowrap font-mono text-[11px]', due.overdue ? 'font-bold text-danger-700 dark:text-red-300' : 'text-slate-500')}><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{due.label}</span></td>
                      <td className="whitespace-nowrap text-right"><Link className="font-semibold text-primary-700 hover:underline dark:text-primary-300" to={item.path}>{item.action}</Link></td>
                    </tr>
                  );
                })}</tbody>
              </DataTable>
            ) : <EmptyState icon={<Inbox className="h-9 w-9" />} title="ไม่มีงานในมุมมองนี้" message="เลือกมุมมองอื่น หรือไปดูคิวของทีมเพื่อรับงานเพิ่ม" action={<Button variant="outline" onClick={() => setScope('all')}>ดูงานทั้งหมด</Button>} />}
          </Card>

          <aside className="space-y-3">
            <Card className="overflow-hidden border-primary-950 bg-primary-950 text-white dark:border-primary-800 dark:bg-[#0b1b36]">
              <CardHeader className="border-white/10 text-white"><span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary-300" />ตารางวันนี้</span></CardHeader>
              <CardBody className="space-y-3">
                {todayItems.length ? todayItems.map((item) => <Link key={`${item.kind}-${item.id}`} to={item.path} className="block border-l-2 border-primary-400 pl-3"><p className="line-clamp-2 text-xs font-semibold text-white">{item.title}</p><p className="mt-1 font-mono text-[9px] text-white/45">{item.dueAt ? formatThaiDate(item.dueAt, 'HH:mm') : 'ไม่ระบุเวลา'} · {item.source}</p></Link>) : <p className="text-xs text-white/45">วันนี้ยังไม่มีงานที่กำหนดเวลาไว้</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="flex items-center gap-2"><UserRoundCheck className="h-4 w-4 text-primary-700" />งานที่มอบหมายให้ฉัน</CardHeader>
              <CardBody className="space-y-3">
                {delegatedItems.length ? delegatedItems.map((item) => <Link key={`${item.kind}-${item.id}`} to={item.path} className="flex items-start gap-2 border-b border-hairline-row pb-3 last:border-0 last:pb-0 dark:border-white/[.07]"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-700" /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-700 dark:text-white/70">{item.title}</span><span className="font-mono text-[9px] text-slate-400">{item.status}</span></span></Link>) : <p className="text-xs text-slate-400">ยังไม่มีงานที่มอบหมาย</p>}
              </CardBody>
            </Card>

            <div className="rounded-card border border-primary-200 bg-primary-100 px-4 py-3 text-xs text-primary-900 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-200">
              ระบบจะรีเฟรชคิวทุก 60 วินาที หากงานเร่งด่วนเข้ามาจะปรากฏในลำดับบนสุดโดยอัตโนมัติ
            </div>
          </aside>
        </div>
        <p className="text-right font-mono text-[9px] text-slate-400">อัปเดตล่าสุด {formatThaiDate(query.data.generatedAt, 'd MMM yyyy HH:mm')}</p>
      </>}
    </div>
  );
}
