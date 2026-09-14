import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  AlertTriangle,
  ArrowDownUp,
  CalendarDays,
  CheckSquare2,
  ClipboardCheck,
  Clock3,
  Inbox,
  Layers3,
  ListFilter,
  RefreshCw,
  Save,
  ShieldAlert,
  UserRoundCheck,
  UserRoundPlus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import type { MyWorkItem, MyWorkQueueItem, MyWorkResponse, MyWorkSavedView } from '../../types/dashboard';
import { formatThaiDate } from '../../utils/date';
import { cn } from '../../utils/cn';

type Scope = 'all' | 'approval' | 'assigned' | 'personal' | 'overdue';
type SortBy = 'risk_sla_due' | 'due_date';

const approvalKinds = new Set<MyWorkItem['kind']>(['service_approval', 'access_approval', 'workflow_approval', 'change_test', 'change_approval']);
const assignedKinds = new Set<MyWorkItem['kind']>([
  'ticket', 'service_request', 'access_fulfillment', 'incident', 'problem', 'vulnerability', 'backup', 'recovery_test',
  'log_review', 'contract_renewal', 'license_renewal', 'governance_capa', 'risk_treatment', 'audit_finding',
]);
const snoozeOptions = [
  { minutes: 15, label: '15 นาที' },
  { minutes: 30, label: '30 นาที' },
  { minutes: 60, label: '1 ชั่วโมง' },
  { minutes: 180, label: '3 ชั่วโมง' },
  { minutes: 1440, label: 'พรุ่งนี้' },
];

function dueState(dueAt: string | null) {
  if (!dueAt) return { label: 'ไม่มีกำหนด', overdue: false };
  const overdue = new Date(dueAt).getTime() < Date.now();
  return { label: formatThaiDate(dueAt, dueAt.length === 10 ? 'd MMM yyyy' : 'd MMM yyyy HH:mm'), overdue };
}

function itemTone(item: MyWorkItem): 'warning' | 'info' | 'secondary' | 'purple' | 'danger' | 'teal' {
  if (item.isOverdue) return 'danger';
  if (approvalKinds.has(item.kind)) return 'warning';
  if (item.kind === 'task') return 'secondary';
  if (item.kind === 'risk_treatment' || item.kind === 'vulnerability' || item.kind === 'audit_finding') return 'danger';
  if (item.kind === 'access_fulfillment') return 'purple';
  if (item.kind === 'contract_renewal' || item.kind === 'license_renewal') return 'teal';
  return 'info';
}

function priorityLabel(item: MyWorkItem): string {
  if (item.kind === 'risk_treatment' && item.riskScore) return `Risk score ${item.riskScore}`;
  return item.priority ? `ระดับ ${item.priority}` : 'งานในระบบ';
}

function countdownLabel(item: MyWorkItem, currentNow: number): { label: string; tone: 'danger' | 'warning' | 'info' | 'secondary' } {
  if (item.slaState === 'paused') return { label: 'หยุดนับ SLA', tone: 'secondary' };
  const remainingSeconds = item.dueAt ? Math.round((Date.parse(item.dueAt) - currentNow) / 1000) : item.slaRemainingSeconds;
  if (remainingSeconds === null) return { label: 'ไม่มี SLA', tone: 'secondary' };
  const absolute = Math.abs(remainingSeconds);
  const days = Math.floor(absolute / 86_400);
  const hours = Math.floor((absolute % 86_400) / 3_600);
  const minutes = Math.max(0, Math.floor((absolute % 3_600) / 60));
  const duration = days > 0 ? `${days} วัน ${hours} ชม.` : hours > 0 ? `${hours} ชม. ${minutes} น.` : `${minutes} นาที`;
  if (remainingSeconds <= 0) return { label: `เกิน SLA ${duration}`, tone: 'danger' };
  if (item.slaState === 'due_soon') return { label: `เหลือ ${duration}`, tone: 'warning' };
  return { label: `เหลือ ${duration}`, tone: 'info' };
}

function compareBySort(left: MyWorkItem, right: MyWorkItem, sortBy: SortBy): number {
  if (sortBy === 'due_date') {
    return (left.dueAt ? Date.parse(left.dueAt) : Number.MAX_SAFE_INTEGER) - (right.dueAt ? Date.parse(right.dueAt) : Number.MAX_SAFE_INTEGER);
  }
  const slaRank: Record<MyWorkItem['slaState'], number> = { overdue: 0, due_soon: 1, on_track: 2, paused: 3, none: 4 };
  return (right.riskScore ?? -1) - (left.riskScore ?? -1)
    || slaRank[left.slaState] - slaRank[right.slaState]
    || (left.dueAt ? Date.parse(left.dueAt) : Number.MAX_SAFE_INTEGER) - (right.dueAt ? Date.parse(right.dueAt) : Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title, 'th');
}

function QueueRow({ item, onClaim, isPending }: { item: MyWorkQueueItem; onClaim: () => void; isPending: boolean }) {
  const due = dueState(item.dueAt);
  return (
    <div className="flex items-start gap-3 border-b border-hairline-row py-3 last:border-0 last:pb-0 dark:border-white/[.07]">
      <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"><Layers3 className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{item.title}</p>
        <p className="mt-1 text-[10px] text-slate-500">{item.source} · {due.label}{due.overdue && <span className="ml-1 font-bold text-red-600">เกินกำหนด</span>}</p>
      </div>
      <Button size="sm" variant="outline" isLoading={isPending} onClick={onClaim} aria-label={`รับงาน ${item.title}`}>
        <UserRoundPlus className="h-3.5 w-3.5" />รับงานนี้
      </Button>
    </div>
  );
}

export function MyWorkPage() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>('all');
  const [sourceKind, setSourceKind] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('risk_sla_due');
  const [viewName, setViewName] = useState('');
  const [selectedViewId, setSelectedViewId] = useState('');
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [snoozeMinutes, setSnoozeMinutes] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const query = useQuery({
    queryKey: ['my-work'],
    queryFn: () => apiFetch<MyWorkResponse>('/api/v1/dashboard/my-work'),
    refetchInterval: 60_000,
  });
  const snoozeMutation = useMutation({
    mutationFn: ({ item, minutes }: { item: MyWorkItem; minutes: number }) => apiFetch(`/api/v1/dashboard/my-work/${item.kind}/${item.id}/snooze`, { method: 'POST', body: JSON.stringify({ minutes }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['my-work'] }),
  });
  const unsnoozeMutation = useMutation({
    mutationFn: (item: { kind: MyWorkItem['kind']; id: string }) => apiFetch(`/api/v1/dashboard/my-work/${item.kind}/${item.id}/snooze`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['my-work'] }),
  });
  const claimMutation = useMutation({
    mutationFn: (item: MyWorkQueueItem) => apiFetch(`/api/v1/dashboard/my-work/team-queue/${item.kind}/${item.id}/claim`, { method: 'POST', body: '{}' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['my-work'] }),
  });
  const saveViewMutation = useMutation({
    mutationFn: () => apiFetch<MyWorkSavedView>('/api/v1/dashboard/my-work/saved-views', { method: 'POST', body: JSON.stringify({ name: viewName, scope, sourceKind: sourceKind || null, sortBy }) }),
    onSuccess: (saved) => { setViewName(''); setSelectedViewId(saved.id); void queryClient.invalidateQueries({ queryKey: ['my-work'] }); },
  });
  const deleteViewMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/dashboard/my-work/saved-views/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setSelectedViewId(''); void queryClient.invalidateQueries({ queryKey: ['my-work'] }); },
  });

  const allItems = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const sourceOptions = useMemo(() => [...new Set(allItems.map((item) => item.source))].sort((a, b) => a.localeCompare(b, 'th')), [allItems]);
  const items = useMemo(() => allItems
    .filter((item) => {
      if (scope === 'approval') return approvalKinds.has(item.kind);
      if (scope === 'assigned') return assignedKinds.has(item.kind);
      if (scope === 'personal') return item.kind === 'task';
      if (scope === 'overdue') return item.isOverdue;
      return true;
    })
    .filter((item) => !sourceKind || item.source === sourceKind)
    .sort((left, right) => compareBySort(left, right, sortBy)), [allItems, scope, sourceKind, sortBy]);
  const todayItems = useMemo(() => allItems.filter((item) => item.dueAt && new Date(item.dueAt).toDateString() === new Date().toDateString()).slice(0, 4), [allItems]);
  const delegatedItems = useMemo(() => allItems.filter((item) => assignedKinds.has(item.kind)).slice(0, 3), [allItems]);
  const views = query.data?.savedViews ?? [];
  const selectedView = views.find((view) => view.id === selectedViewId);

  const applyView = (view: MyWorkSavedView | undefined) => {
    if (!view) return;
    setSelectedViewId(view.id);
    setScope(view.scope);
    setSourceKind(view.sourceKind ?? '');
    setSortBy(view.sortBy);
  };

  return (
    <div className="space-y-4" data-testid="my-work-page">
      <PageHeader
        eyebrow="พื้นที่ทำงาน / Unified inbox"
        title="ศูนย์งานของฉัน"
        description="รวมงานที่ได้รับมอบหมาย งานอนุมัติ งานควบคุมความเสี่ยง และงานส่วนตัวไว้ในหน้าจอเดียว"
        leading={<Inbox className="h-5 w-5" />}
        primaryAction={<Button variant="outline" size="sm" onClick={() => { setNow(Date.now()); void query.refetch(); }} disabled={query.isFetching}><RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />รีเฟรช</Button>}
      />

      {query.isLoading && <Card><LoadingState label="กำลังรวบรวมงานของคุณ..." rows={6} /></Card>}
      {query.isError && <QueryError title="โหลดศูนย์งานไม่สำเร็จ" error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}
      {query.data && <>
        <KpiStrip
          label="สรุปงานที่ต้องดำเนินการ"
          items={[
            { key: 'all', label: 'ทั้งหมด', value: query.data.summary.total, note: 'งานที่ยังแสดงอยู่', icon: <Inbox className="h-4 w-4" />, active: scope === 'all', onClick: () => setScope('all'), tone: 'primary' },
            { key: 'overdue', label: 'เกินกำหนด', value: query.data.summary.overdue, note: 'จัดการก่อน', icon: <AlertTriangle className="h-4 w-4" />, active: scope === 'overdue', onClick: () => setScope(scope === 'overdue' ? 'all' : 'overdue'), tone: query.data.summary.overdue ? 'danger' : 'teal' },
            { key: 'approval', label: 'รอพิจารณา', value: query.data.summary.approvals, note: 'อนุมัติ/ทดสอบ Change', icon: <ClipboardCheck className="h-4 w-4" />, active: scope === 'approval', onClick: () => setScope(scope === 'approval' ? 'all' : 'approval'), tone: 'amber' },
            { key: 'assigned', label: 'งานที่รับผิดชอบ', value: query.data.summary.assigned, note: 'งานปฏิบัติการและควบคุม', icon: <CheckSquare2 className="h-4 w-4" />, active: scope === 'assigned', onClick: () => setScope(scope === 'assigned' ? 'all' : 'assigned'), tone: 'teal' },
            { key: 'queue', label: 'คิวทีม', value: query.data.summary.teamQueue, note: 'พร้อมรับงาน', icon: <UserRoundCheck className="h-4 w-4" />, tone: 'primary' },
          ]}
        />

        <Card>
          <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">มุมมองที่บันทึกไว้
                <select aria-label="มุมมองที่บันทึกไว้" value={selectedViewId} onChange={(event) => applyView(views.find((view) => view.id === event.target.value))} className="mt-1 block min-h-9 min-w-[180px] rounded-[7px] border border-slate-300 bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-800">
                  <option value="">มุมมองปัจจุบัน</option>
                  {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">แหล่งงาน
                <select aria-label="กรองตามแหล่งงาน" value={sourceKind} onChange={(event) => { setSourceKind(event.target.value); setSelectedViewId(''); }} className="mt-1 block min-h-9 min-w-[180px] rounded-[7px] border border-slate-300 bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-800">
                  <option value="">ทุกแหล่งงาน</option>
                  {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">เรียงตาม
                <select aria-label="ลำดับงาน" value={sortBy} onChange={(event) => { setSortBy(event.target.value as SortBy); setSelectedViewId(''); }} className="mt-1 block min-h-9 min-w-[220px] rounded-[7px] border border-slate-300 bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-800">
                  <option value="risk_sla_due">Risk สูง → SLA เร่งด่วน → Due Date</option>
                  <option value="due_date">Due Date ใกล้สุด</option>
                </select>
              </label>
              <span className="inline-flex min-h-9 items-center gap-2 rounded-[7px] bg-primary-50 px-3 text-xs text-primary-800 dark:bg-primary-900/30 dark:text-primary-200"><ListFilter className="h-3.5 w-3.5" />{items.length} รายการในมุมมองนี้</span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อ Saved View
                <input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="เช่น งานเสี่ยงสูงของฉัน" className="mt-1 block min-h-9 w-[190px] rounded-[7px] border border-slate-300 px-3 text-xs dark:border-slate-600 dark:bg-slate-800" />
              </label>
              <Button size="sm" onClick={() => saveViewMutation.mutate()} disabled={!viewName.trim()} isLoading={saveViewMutation.isPending}><Save className="h-3.5 w-3.5" />บันทึกมุมมอง</Button>
              {selectedView && <Button size="sm" variant="ghost" onClick={() => deleteViewMutation.mutate(selectedView.id)} disabled={deleteViewMutation.isPending} aria-label={`ลบ Saved View ${selectedView.name}`}><X className="h-3.5 w-3.5" />ลบมุมมอง</Button>}
            </div>
          </CardBody>
        </Card>

        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2"><ArrowDownUp className="h-4 w-4 text-primary-700" />งานที่ควรทำก่อน</span>
              <div className="flex rounded-[8px] bg-surface-muted p-0.5 dark:bg-white/[.07]">
                {([
                  ['all', 'ทั้งหมด'], ['approval', 'อนุมัติ/ทดสอบ'], ['assigned', 'งานรับผิดชอบ'], ['personal', 'ส่วนตัว'], ['overdue', 'เกินกำหนด'],
                ] as Array<[Scope, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => { setScope(value); setSelectedViewId(''); }} className={cn('rounded-[6px] px-3 py-1.5 text-[11.5px] font-medium text-slate-500', scope === value && 'bg-white font-bold text-primary-700 shadow-sm dark:bg-white/[.1] dark:text-primary-300')} aria-pressed={scope === value}>{label}</button>)}
              </div>
            </CardHeader>
            {items.length ? (
              <DataTable tableId="my-work" toolbar={false} pagination={false} className="min-w-[1080px]">
                <thead><tr><th className="w-[150px]">แหล่งงาน</th><th>รายการ</th><th className="w-[92px]">Risk</th><th className="w-[180px]">SLA Countdown</th><th className="w-[155px]">กำหนด</th><th className="w-[150px] text-right">ดำเนินการ</th></tr></thead>
                <tbody>{items.map((item) => {
                  const due = dueState(item.dueAt);
                  const countdown = countdownLabel(item, now);
                  const isSnoozing = snoozeMutation.isPending && snoozeMutation.variables?.item.id === item.id;
                  return (
                    <tr key={`${item.kind}-${item.id}`} className={cn(item.isOverdue ? 'shadow-[inset_3px_0_0_#dc2626]' : approvalKinds.has(item.kind) ? 'shadow-[inset_3px_0_0_#d97706]' : 'shadow-[inset_3px_0_0_#1d4ed8]')}>
                      <td className="whitespace-nowrap"><Badge variant={itemTone(item)}>{item.source}</Badge></td>
                      <td className="max-w-[410px]"><p className="truncate font-semibold text-slate-800 dark:text-slate-100">{item.title}</p><p className="mt-0.5 font-mono text-[10px] text-slate-400">{priorityLabel(item)} · {item.status}</p></td>
                      <td className="whitespace-nowrap">{item.riskScore ? <Badge variant={item.riskScore >= 16 ? 'danger' : item.riskScore >= 10 ? 'warning' : 'secondary'}><ShieldAlert className="h-3 w-3" />{item.riskScore}</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
                      <td className="whitespace-nowrap"><Badge variant={countdown.tone}><Clock3 className="h-3 w-3" />{countdown.label}</Badge></td>
                      <td className={cn('whitespace-nowrap text-xs', due.overdue ? 'font-bold text-danger-700 dark:text-red-300' : 'text-slate-500')}><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{due.label}</span></td>
                      <td className="whitespace-nowrap text-right"><div className="flex justify-end gap-1"><Link className="inline-flex min-h-9 items-center rounded-[7px] px-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 hover:underline dark:text-primary-300" to={item.path}>{item.action}</Link><Button size="sm" variant="ghost" isLoading={isSnoozing} onClick={() => snoozeMutation.mutate({ item, minutes: snoozeMinutes })} title={`เตือนฉันภายหลัง ${snoozeOptions.find((option) => option.minutes === snoozeMinutes)?.label}`} aria-label={`เตือนฉันภายหลัง ${item.title}`}><AlarmClock className="h-4 w-4" /></Button></div></td>
                    </tr>
                  );
                })}</tbody>
              </DataTable>
            ) : <EmptyState icon={<Inbox className="h-9 w-9" />} title="ไม่มีงานในมุมมองนี้" message="เลือกมุมมองอื่น หรือไปดูคิวของทีมเพื่อรับงานเพิ่ม" action={<Button variant="outline" onClick={() => { setScope('all'); setSourceKind(''); }}>ดูงานทั้งหมด</Button>} />}
          </Card>

          <aside className="space-y-3">
            <Card className="border-primary-950 bg-primary-950 text-white dark:border-primary-800 dark:bg-[#0b1b36]">
              <CardHeader className="flex items-center justify-between border-white/10 text-white"><span className="flex items-center gap-2"><UserRoundCheck className="h-4 w-4 text-primary-300" />Team Queue</span><Badge variant="primary">{query.data.teamQueue.length}</Badge></CardHeader>
              <CardBody>
                {query.data.teamQueue.length ? <div>{query.data.teamQueue.slice(0, 6).map((item) => <QueueRow key={`${item.kind}-${item.id}`} item={item} onClaim={() => claimMutation.mutate(item)} isPending={claimMutation.isPending && claimMutation.variables?.id === item.id} />)}</div> : <p className="text-xs text-white/55">ยังไม่มีงานว่างในคิวทีม</p>}
                {query.data.teamQueue.length > 6 && <p className="mt-3 text-[10px] text-white/45">แสดง 6 รายการแรก โดยเรียงตาม Risk และ SLA</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary-700" />กำหนดวันนี้</span><Badge variant="secondary">{todayItems.length}</Badge></CardHeader>
              <CardBody className="space-y-3">
                {todayItems.length ? todayItems.map((item) => <Link key={`${item.kind}-${item.id}`} to={item.path} className="block border-l-2 border-primary-400 pl-3"><p className="line-clamp-2 text-xs font-semibold text-slate-700 dark:text-white/80">{item.title}</p><p className="mt-1 font-mono text-[9px] text-slate-400">{item.dueAt ? formatThaiDate(item.dueAt, 'HH:mm') : 'ไม่ระบุเวลา'} · {item.source}</p></Link>) : <p className="text-xs text-slate-400">วันนี้ยังไม่มีงานที่กำหนดเวลาไว้</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="flex items-center gap-2"><UserRoundCheck className="h-4 w-4 text-primary-700" />งานที่ฉันรับผิดชอบ</CardHeader>
              <CardBody className="space-y-3">
                {delegatedItems.length ? delegatedItems.map((item) => <Link key={`${item.kind}-${item.id}`} to={item.path} className="flex items-start gap-2 border-b border-hairline-row pb-3 last:border-0 last:pb-0 dark:border-white/[.07]"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-700" /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-700 dark:text-white/70">{item.title}</span><span className="font-mono text-[9px] text-slate-400">{item.source} · {item.status}</span></span></Link>) : <p className="text-xs text-slate-400">ยังไม่มีงานที่รับผิดชอบ</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><AlarmClock className="h-4 w-4 text-amber-600" />เตือนฉันภายหลัง</span><Badge variant="warning">{query.data.summary.snoozed}</Badge></CardHeader>
              <CardBody className="space-y-3">
                <div className="flex items-center gap-2"><select aria-label="ระยะเวลาเตือนภายหลัง" value={snoozeMinutes} onChange={(event) => setSnoozeMinutes(Number(event.target.value))} className="min-h-9 flex-1 rounded-[7px] border border-slate-300 bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-800">{snoozeOptions.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}</select><span className="text-[10px] text-slate-400">กดไอคอนนาฬิกาที่รายการ</span></div>
                {query.data.summary.snoozed > 0 && <Button size="sm" variant="outline" onClick={() => setShowSnoozed((value) => !value)}>{showSnoozed ? 'ซ่อนรายการที่เลื่อน' : 'ดูรายการที่เลื่อน'}</Button>}
                {showSnoozed && query.data.snoozedItems.map((item) => <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[.05]"><p className="min-w-0 truncate text-xs font-semibold">{item.title}</p><Button size="sm" variant="ghost" onClick={() => unsnoozeMutation.mutate(item)} disabled={unsnoozeMutation.isPending}>นำกลับ</Button></div>)}
              </CardBody>
            </Card>

            <div className="rounded-card border border-primary-200 bg-primary-50 px-4 py-3 text-xs text-primary-900 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-200">ระบบจะรีเฟรชคิวทุก 60 วินาที และนับ SLA ต่อเนื่องบนหน้าจอ งานที่กดเตือนภายหลังจะถูกซ่อนชั่วคราวแต่ยังนับรวมในตัวเลขเกินกำหนด</div>
          </aside>
        </div>
        <p className="text-right font-mono text-[9px] text-slate-400">อัปเดตล่าสุด {formatThaiDate(query.data.generatedAt, 'd MMM yyyy HH:mm')}</p>
      </>}
    </div>
  );
}
