import { DataTable } from '../components/table/DataTable';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, BarChart3, CalendarClock, CheckCircle2,
  ClipboardList, Clock3, Gauge, Loader2, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { dashboardBarWidth, dashboardDueLabel } from '../features/dashboard/dashboardDisplay';
import { apiFetch } from '../services/apiClient';
import { useAuth } from '../stores/authContext';
import type { DashboardMode, DashboardSummary, DashboardTone } from '../types/dashboard';
import { formatThaiDate, formatThaiDateTime } from '../utils/date';

const LEAD_OPTIONS = [
  { value: 7, label: '7 วัน' },
  { value: 30, label: '30 วัน' },
  { value: 60, label: '60 วัน' },
  { value: 90, label: '90 วัน' },
];

const MODE_COPY: Record<DashboardMode, { eyebrow: string; title: string; description: string }> = {
  executive: { eyebrow: 'Executive overview', title: 'ภาพรวมการกำกับดูแลและความเสี่ยง', description: 'ติดตามเหตุการณ์สำคัญ งานเกินกำหนด และสุขภาพมาตรการควบคุมจากข้อมูลที่ท่านเข้าถึงได้' },
  privacy: { eyebrow: 'Privacy & DPO overview', title: 'ภาพรวมการคุ้มครองข้อมูลส่วนบุคคล', description: 'จัดลำดับ Incident ข้อมูลส่วนบุคคลและเส้นตายที่ต้องดำเนินการก่อน' },
  operations: { eyebrow: 'IT operations overview', title: 'ศูนย์ควบคุมงานปฏิบัติการไอที', description: 'เห็น Ticket คำขอบริการ งานส่วนตัว และเหตุการณ์ที่ต้องเร่งจัดการในหน้าเดียว' },
  personal: { eyebrow: 'My service overview', title: 'งานและคำขอของฉัน', description: 'ติดตามรายการที่เกี่ยวข้องกับท่าน โดยระบบจำกัดข้อมูลตามสิทธิ์และ RLS อัตโนมัติ' },
};

const TONE = {
  primary: { badge: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200', bar: 'bg-primary-600', border: 'border-primary-200 dark:border-primary-900' },
  teal: { badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200', bar: 'bg-teal-600', border: 'border-teal-200 dark:border-teal-900' },
  amber: { badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200', bar: 'bg-amber-500', border: 'border-amber-200 dark:border-amber-900' },
  danger: { badge: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200', bar: 'bg-red-600', border: 'border-red-200 dark:border-red-900' },
  gray: { badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', bar: 'bg-slate-400', border: 'border-slate-200 dark:border-slate-700' },
} satisfies Record<DashboardTone, { badge: string; bar: string; border: string }>;

const dueLabel = dashboardDueLabel;

function metricIcon(tone: DashboardTone): ReactNode {
  if (tone === 'danger') return <AlertTriangle className="h-5 w-5" />;
  if (tone === 'teal') return <CheckCircle2 className="h-5 w-5" />;
  if (tone === 'amber') return <Clock3 className="h-5 w-5" />;
  return <Gauge className="h-5 w-5" />;
}

export function HomePage() {
  const { me, hasPermission } = useAuth();
  const [leadDays, setLeadDays] = useState(30);
  const dashboard = useQuery({
    queryKey: ['dashboard', leadDays],
    queryFn: () => apiFetch<DashboardSummary>(`/api/v1/dashboard/summary?leadDays=${leadDays}`),
    enabled: hasPermission('dashboard.view'),
  });

  if (!hasPermission('dashboard.view')) {
    return <EmptyState icon={<ShieldCheck className="h-10 w-10" />} title="ไม่มีสิทธิ์ดู Dashboard" message="ติดต่อผู้ดูแลระบบหากต้องการเข้าถึงภาพรวมการทำงาน" />;
  }

  const copy = MODE_COPY[dashboard.data?.mode ?? 'personal'];
  return (
    <div className="space-y-5" data-testid="dashboard-page">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-900 via-primary-800 to-primary-600 px-5 py-6 text-white shadow-elevated sm:px-7 sm:py-7">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10" aria-hidden="true" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-200">{copy.eyebrow}</p>
            <h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">สวัสดี {me?.profile.full_name ?? 'ผู้ใช้งาน'}</h1>
            <p className="mt-1 text-lg font-semibold text-white/95">{copy.title}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-primary-100">{copy.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/10 p-2 backdrop-blur-sm">
            <label className="text-xs font-semibold text-primary-100">
              เตือนล่วงหน้า
              <select aria-label="ช่วงเตือนล่วงหน้า" value={leadDays} onChange={(event) => setLeadDays(Number(event.target.value))} className="ml-2 rounded-lg border border-white/20 bg-primary-900 px-3 py-2 text-sm text-white outline-none">
                {LEAD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => void dashboard.refetch()} disabled={dashboard.isFetching}>
              <RefreshCw className={`h-4 w-4 ${dashboard.isFetching ? 'animate-spin' : ''}`} />รีเฟรช
            </Button>
          </div>
        </div>
      </section>

      {dashboard.isLoading && <div className="flex justify-center py-24" role="status"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /><span className="sr-only">กำลังโหลด Dashboard</span></div>}
      {dashboard.isError && (
        <QueryError
          title="โหลด Dashboard ไม่สำเร็จ"
          error={dashboard.error}
          onRetry={() => void dashboard.refetch()}
          isRetrying={dashboard.isFetching}
        />
      )}

      {dashboard.data && (
        <>
          {dashboard.data.alertCount > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" role="alert">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="font-bold">มี {dashboard.data.alertCount.toLocaleString('th-TH')} จุดที่ต้องติดตามเร่งด่วน</p><p className="mt-0.5 text-xs opacity-80">รวมรายการเกินกำหนดและ Incident ระดับสูง/วิกฤตที่ท่านมีสิทธิ์เห็น</p></div>
            </div>
          )}

          <section aria-labelledby="dashboard-kpi-title">
            <h2 id="dashboard-kpi-title" className="mb-3 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">ตัวชี้วัดสำคัญ</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {dashboard.data.metrics.map((metric) => metric.path ? (
                <Link key={metric.label} to={metric.path} className="rounded-2xl transition hover:-translate-y-0.5 hover:shadow-elevated"><StatCard icon={metricIcon(metric.tone)} label={metric.label} value={metric.value} note={metric.note} tone={metric.tone} /></Link>
              ) : <StatCard key={metric.label} icon={metricIcon(metric.tone)} label={metric.label} value={metric.value} note={metric.note} tone={metric.tone} />)}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
            <Card>
              <CardHeader className="flex items-center justify-between gap-3"><span>สุขภาพงานควบคุมเชิงปฏิบัติการ</span><span className="text-xs font-normal text-slate-400">ตามสิทธิ์ของบัญชี</span></CardHeader>
              <CardBody>
                {dashboard.data.cards.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {dashboard.data.cards.map((card) => (
                    <Link key={card.key} to={card.path} className={`group relative overflow-hidden rounded-xl border p-3 transition hover:-translate-y-0.5 hover:shadow-card ${TONE[card.tone].border}`}>
                      <div className={`absolute inset-x-0 top-0 h-1 ${TONE[card.tone].bar}`} />
                      <div className="flex items-start justify-between gap-2 pt-1"><p className="font-bold text-slate-800 dark:text-slate-100">{card.label}</p><ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary-600" /></div>
                      <p className="mt-2 text-2xl font-extrabold text-slate-800 dark:text-white">{card.total.toLocaleString('th-TH')}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]"><span className={`rounded-full px-2 py-1 ${TONE[card.tone].badge}`}>{card.overdue ? `เกินกำหนด ${card.overdue}` : card.warning ? `ใกล้กำหนด ${card.warning}` : 'ปกติ'}</span>{card.overdue > 0 && card.warning > 0 && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">ใกล้กำหนด {card.warning}</span>}{card.truncated && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-700 dark:text-slate-300" title={`ข้อมูลมี ${card.total.toLocaleString('th-TH')} รายการ ระบบนับสถานะครบกำหนดจาก ${card.scanned.toLocaleString('th-TH')} รายการล่าสุด`}>นับจาก {card.scanned.toLocaleString('th-TH')} ล่าสุด</span>}</div>
                    </Link>
                  ))}
                </div> : <p className="py-8 text-center text-sm text-slate-400">ไม่มีแหล่งข้อมูลควบคุมที่บัญชีนี้เข้าถึงได้</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>สัดส่วนงานสำคัญ</CardHeader>
              <CardBody className="space-y-5">
                {dashboard.data.breakdowns.map((breakdown) => {
                  return <div key={breakdown.key}><h3 className="mb-2 text-xs font-bold text-slate-500">{breakdown.label}</h3>{breakdown.items.length ? <div className="space-y-2">{breakdown.items.slice(0, 6).map((item) => <div key={item.label} className="grid grid-cols-[minmax(72px,1fr)_2fr_36px] items-center gap-2 text-xs"><span className="truncate" title={item.label}>{item.label}</span><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-primary-600" style={{ width: `${dashboardBarWidth(item.value, breakdown.items.map((entry) => entry.value))}%` }} /></div><span className="text-right font-bold">{item.value}</span></div>)}</div> : <p className="text-xs text-slate-400">ไม่มีข้อมูล</p>}</div>;
                })}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span>กำหนดการที่ต้องติดตาม</span><span className="text-xs font-normal text-slate-400">เกินกำหนดก่อน · แสดงสูงสุด 30 รายการ</span></CardHeader>
            {dashboard.data.upcoming.length ? <div className="overflow-x-auto"><DataTable className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40"><tr><th className="px-5 py-3 font-semibold">แหล่งข้อมูล</th><th className="px-5 py-3 font-semibold">รายการ</th><th className="px-5 py-3 font-semibold">สถานะ</th><th className="px-5 py-3 font-semibold">ครบกำหนด</th><th className="px-5 py-3 text-right font-semibold">คงเหลือ</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{dashboard.data.upcoming.map((item) => <tr key={`${item.source}-${item.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/30"><td className="whitespace-nowrap px-5 py-3"><Link to={item.path} className="font-semibold text-primary-700 hover:underline dark:text-primary-300">{item.source}</Link></td><td className="max-w-[380px] truncate px-5 py-3 text-slate-800 dark:text-slate-100" title={item.title}>{item.title}</td><td className="whitespace-nowrap px-5 py-3 text-slate-500">{item.status || '—'}</td><td className="whitespace-nowrap px-5 py-3 text-slate-500"><span className="inline-flex items-center gap-1"><CalendarClock className="h-4 w-4" />{formatThaiDate(item.dueAt, 'd MMM yyyy')}</span></td><td className="whitespace-nowrap px-5 py-3 text-right"><span className={`rounded-full px-2 py-1 text-xs font-bold ${TONE[item.tone].badge}`}>{dueLabel(item.daysRemaining)}</span></td></tr>)}</tbody></DataTable></div> : <CardBody className="py-12 text-center"><ClipboardList className="mx-auto h-9 w-9 text-teal-500" /><p className="mt-2 font-semibold text-slate-700 dark:text-slate-200">ไม่มีรายการใกล้หรือเกินกำหนด</p><p className="mt-1 text-xs text-slate-400">ภายในช่วง {dashboard.data.leadDays} วันที่เลือก</p></CardBody>}
          </Card>

          <p className="text-right text-xs text-slate-400"><BarChart3 className="mr-1 inline h-3.5 w-3.5" />อัปเดตล่าสุด {formatThaiDateTime(dashboard.data.generatedAt)}</p>
        </>
      )}
    </div>
  );
}
