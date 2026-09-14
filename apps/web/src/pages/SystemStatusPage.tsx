import type { SystemStatusComponent, SystemStatusResponse } from '@itlife/shared';
import {
  Activity, AlertTriangle, CalendarClock, CheckCircle2, CloudCog, Database, HardDrive,
  History, Layers, Loader2, Mail, MessageCircle, RefreshCw, Server, ShieldCheck, Timer, TriangleAlert,
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageTitle } from '../components/ui/PageTitle';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { ApiError } from '../services/apiClient';
import { formatThaiDateTime } from '../utils/date';

type Status = SystemStatusComponent['status'];

const STATUS_COPY: Record<Status, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary'; dot: string }> = {
  operational: { label: 'ปกติ', variant: 'success', dot: 'bg-success-600' },
  degraded: { label: 'ทำงานได้บางส่วน', variant: 'warning', dot: 'bg-warning-600' },
  down: { label: 'ขัดข้อง', variant: 'danger', dot: 'bg-danger-600' },
  not_configured: { label: 'ยังไม่ตั้งค่า', variant: 'secondary', dot: 'bg-slate-400' },
  unknown: { label: 'ยังไม่มีข้อมูล', variant: 'secondary', dot: 'bg-slate-300' },
};

const ICONS: Record<string, typeof Activity> = {
  api: Server,
  database: Database,
  supabase_auth: ShieldCheck,
  storage: HardDrive,
  cloudflare_worker: CloudCog,
  line_messaging: MessageCircle,
  smtp: Mail,
  google_drive: Layers,
  scheduled_jobs: CalendarClock,
  outbox_queue: Activity,
};

function statusVariant(status: SystemStatusResponse['overallStatus']): 'success' | 'warning' | 'danger' | 'secondary' {
  if (status === 'operational') return 'success';
  if (status === 'degraded') return 'warning';
  if (status === 'down') return 'danger';
  return 'secondary';
}

function overallLabel(status: SystemStatusResponse['overallStatus']): string {
  return status === 'operational' ? 'ระบบทำงานปกติ' : status === 'degraded' ? 'ระบบทำงานได้บางส่วน' : status === 'down' ? 'ระบบมีส่วนขัดข้อง' : 'กำลังรอข้อมูลตรวจสอบ';
}

function percent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

function milliseconds(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('th-TH')} ms`;
}

function ComponentCard({ component }: { component: SystemStatusComponent }) {
  const status = STATUS_COPY[component.status];
  const Icon = ICONS[component.id] ?? Activity;
  const border = component.status === 'down' ? 'border-danger-300 dark:border-danger-700' : component.status === 'degraded' ? 'border-warning-300 dark:border-warning-700' : 'border-hairline dark:border-white/[.08]';
  return (
    <article className={`rounded-card border bg-white p-4 shadow-card dark:bg-white/[.035] ${border}`} data-testid={`system-status-${component.id}`}>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300"><Icon className="h-4 w-4" aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-[13px] font-bold text-ink-heading dark:text-white">{component.name}</h2><Badge variant={status.variant}><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</Badge></div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{component.critical ? 'องค์ประกอบหลักของบริการ' : 'Integration / งานเสริม'}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center dark:border-white/[.07]">
        {([['24 ชม.', component.uptime.hours24], ['7 วัน', component.uptime.days7], ['30 วัน', component.uptime.days30]] as const).map(([label, value]) => (
          <div key={label}><p className="font-mono text-sm font-bold text-slate-800 dark:text-slate-100">{percent(value)}</p><p className="text-[10px] text-slate-400">Uptime {label}</p></div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span>Response {milliseconds(component.responseTimeMs)}</span>
        <span>{component.checkedAt ? formatThaiDateTime(component.checkedAt) : 'ยังไม่มีผลตรวจ'}</span>
      </div>
      {component.averageResponseTimeMs.days30 !== null && <p className="mt-1 text-[10px] text-slate-400">เฉลี่ย 30 วัน {milliseconds(component.averageResponseTimeMs.days30)}</p>}
      {component.lastFailureAt && <p className="mt-2 rounded-md bg-red-50 px-2.5 py-2 text-[10px] leading-4 text-red-700 dark:bg-red-950/30 dark:text-red-200">Last failure: {formatThaiDateTime(component.lastFailureAt)} · {component.lastFailureReason ?? 'health check failed'}</p>}
      {component.status === 'not_configured' && <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-2 text-[10px] leading-4 text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">ยังไม่มี configuration สำหรับตรวจการเชื่อมต่อ</p>}
    </article>
  );
}

function IncidentHistory({ incidents }: { incidents: SystemStatusResponse['incidents'] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><History className="h-4 w-4 text-primary-600" />Incident History</span><span className="font-mono text-[10px] font-normal text-slate-400">เก็บรายการล่าสุด 50 รายการ</span></CardHeader>
      {incidents.length ? <div>{incidents.map((incident) => <div key={incident.id} className="grid gap-2 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-white/[.07] md:grid-cols-[minmax(0,1fr)_130px_150px] md:items-center">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{incident.title}</p><Badge variant={incident.status === 'open' ? 'danger' : 'success'}>{incident.status === 'open' ? 'กำลังดำเนินการ' : 'แก้ไขแล้ว'}</Badge><Badge variant={incident.severity === 'critical' ? 'danger' : incident.severity === 'major' ? 'warning' : 'secondary'}>{incident.severity}</Badge></div><p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{incident.componentName} · {incident.summary}</p></div>
        <div className="text-[10px] text-slate-500"><span className="font-semibold">เริ่ม:</span> {formatThaiDateTime(incident.startedAt)}<br /><span className="font-semibold">Failure:</span> {formatThaiDateTime(incident.lastFailureAt)}</div>
        <div className="text-[10px] text-slate-500 md:text-right">{incident.resolvedAt ? `แก้ไข ${formatThaiDateTime(incident.resolvedAt)}` : 'ยังเปิดอยู่'} · {incident.failureCount} ครั้ง</div>
      </div>)}</div> : <CardBody><EmptyState icon={<CheckCircle2 className="h-9 w-9" />} title="ยังไม่มี Incident" message="เมื่อ health check พบปัญหา ระบบจะบันทึก incident และปิดรายการเมื่อกลับมาปกติ" /></CardBody>}
    </Card>
  );
}

export function SystemStatusPage() {
  const query = useSystemStatus();
  const data = query.data;
  const critical = data?.components.filter((component) => component.critical && component.uptime.days30 !== null) ?? [];
  const availability30d = critical.length ? critical.reduce((sum, component) => sum + (component.uptime.days30 ?? 0), 0) / critical.length : null;
  const maxResponse = data?.components.reduce<number | null>((max, component) => component.responseTimeMs === null ? max : Math.max(max ?? 0, component.responseTimeMs), null) ?? null;

  return (
    <div className="space-y-5" data-testid="system-status-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle eyebrow="Operations / Observability" title="สถานะระบบ" description="ตรวจสอบสุขภาพของ API, ฐานข้อมูล, integrations, scheduled jobs และ outbox พร้อม uptime และประวัติ incident" leading={<Activity className="h-4 w-4" />} meta={data && <Badge variant={statusVariant(data.overallStatus)}>{overallLabel(data.overallStatus)}</Badge>} />
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}รีเฟรช</Button>
      </div>

      {query.isLoading && <div className="flex justify-center py-24" role="status"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>}
      {query.isError && <EmptyState icon={<TriangleAlert className="h-10 w-10" />} title="โหลดสถานะระบบไม่สำเร็จ" message={query.error instanceof ApiError || query.error instanceof Error ? query.error.message : 'กรุณาลองใหม่อีกครั้ง'} action={<Button onClick={() => void query.refetch()}>ลองอีกครั้ง</Button>} />}

      {data && <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Component ที่ปกติ" value={`${data.summary.operational}/${data.summary.total}`} tone={data.summary.down ? 'danger' : data.summary.degraded ? 'amber' : 'teal'} />
          <StatCard icon={<Timer className="h-5 w-5" />} label="Uptime เฉลี่ย 30 วัน (Core)" value={percent(availability30d)} note={`เป้าหมาย SLO ${data.targets.sloPercent}%`} tone={availability30d !== null && availability30d < data.targets.sloPercent ? 'amber' : 'teal'} />
          <StatCard icon={<Activity className="h-5 w-5" />} label="Response สูงสุดล่าสุด" value={milliseconds(maxResponse)} note={`เป้าหมาย ${data.targets.responseTimeMs.toLocaleString('th-TH')} ms`} tone={maxResponse !== null && maxResponse > data.targets.responseTimeMs ? 'amber' : 'primary'} />
          <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Incident ที่เปิดอยู่" value={data.summary.openIncidents} tone={data.summary.openIncidents ? 'danger' : 'gray'} />
        </div>

        <Card><CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary-600" />SLO / SLA</span><span className="font-mono text-[10px] font-normal text-slate-400">ตรวจล่าสุด {formatThaiDateTime(data.generatedAt)}</span></CardHeader><CardBody className="grid gap-3 text-xs sm:grid-cols-3"><div className="rounded-lg bg-primary-50 p-3 dark:bg-primary-950/30"><p className="font-mono text-[10px] uppercase text-primary-700 dark:text-primary-300">SLO · 30 วัน</p><p className="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100">{data.targets.sloPercent}%</p><p className="mt-1 text-[11px] text-slate-500">เป้าหมาย availability จาก health samples</p></div><div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60"><p className="font-mono text-[10px] uppercase text-slate-500">SLA</p><p className="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100">{data.targets.slaPercent}%</p><p className="mt-1 text-[11px] text-slate-500">เป้าหมาย availability สำหรับรายงานภายใน</p></div><div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/60"><p className="font-mono text-[10px] uppercase text-slate-500">Response target</p><p className="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100">{data.targets.responseTimeMs.toLocaleString('th-TH')} ms</p><p className="mt-1 text-[11px] text-slate-500">วัดแยกตาม component ทุกครั้งที่ตรวจ</p></div></CardBody></Card>

        <div><div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-bold text-ink-heading dark:text-white"><Server className="h-4 w-4 text-primary-600" />Component Health</h2><span className="flex items-center gap-1 text-[10px] text-slate-400"><Clock3Icon />{data.responseTimeMs} ms query</span></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.components.map((component) => <ComponentCard key={component.id} component={component} />)}</div></div>
        <IncidentHistory incidents={data.incidents} />
      </>}
    </div>
  );
}

function Clock3Icon() {
  return <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />;
}
