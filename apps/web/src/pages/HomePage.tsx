import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  Gauge,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../components/table/DataTable';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { KpiStrip } from '../components/ui/KpiStrip';
import { LoadingState } from '../components/ui/AsyncState';
import { QueryError } from '../components/ui/QueryError';
import { StatusBadge, type StatusTone } from '../components/ui/StatusBadge';
import { dashboardBarWidth, dashboardDueLabel } from '../features/dashboard/dashboardDisplay';
import { ExecutiveServiceAnalytics } from '../features/dashboard/ExecutiveServiceAnalytics';
import { apiFetch } from '../services/apiClient';
import { useAuth } from '../stores/authContext';
import type { DashboardCard, DashboardMetric, DashboardMode, DashboardSummary, DashboardTone } from '../types/dashboard';
import { downloadCsv } from '../utils/csv';
import { formatThaiDate, formatThaiDateTime } from '../utils/date';

const LEAD_OPTIONS = [
  { value: 7, label: '7 วัน' },
  { value: 30, label: '30 วัน' },
  { value: 90, label: '90 วัน' },
];

const MODE_COPY: Record<DashboardMode, { eyebrow: string; title: string; description: string }> = {
  executive: { eyebrow: 'Executive overview', title: 'ภาพรวมการกำกับดูแลและความเสี่ยง', description: 'ติดตามเหตุการณ์สำคัญ งานเกินกำหนด และสุขภาพมาตรการควบคุมจากข้อมูลที่ท่านเข้าถึงได้' },
  privacy: { eyebrow: 'Privacy & DPO overview', title: 'ภาพรวมการคุ้มครองข้อมูลส่วนบุคคล', description: 'จัดลำดับ Incident ข้อมูลส่วนบุคคลและเส้นตายที่ต้องดำเนินการก่อน' },
  operations: { eyebrow: 'IT operations overview', title: 'ศูนย์ควบคุมงานปฏิบัติการไอที', description: 'เห็น Ticket คำขอบริการ งานส่วนตัว และเหตุการณ์ที่ต้องเร่งจัดการในหน้าเดียว' },
  personal: { eyebrow: 'My service overview', title: 'งานและคำขอของฉัน', description: 'ติดตามรายการที่เกี่ยวข้องกับท่าน โดยระบบจำกัดข้อมูลตามสิทธิ์และ RLS อัตโนมัติ' },
};

const TONE = {
  primary: { bar: 'bg-primary-600' },
  teal: { bar: 'bg-success-600' },
  amber: { bar: 'bg-warning-600' },
  danger: { bar: 'bg-danger-700' },
  gray: { bar: 'bg-slate-400' },
} satisfies Record<DashboardTone, { bar: string }>;

const STATUS_TONE: Record<DashboardTone, StatusTone> = {
  primary: 'primary',
  teal: 'success',
  amber: 'warning',
  danger: 'danger',
  gray: 'secondary',
};

function metricIcon(tone: DashboardTone): ReactNode {
  if (tone === 'danger') return <AlertTriangle className="h-3.5 w-3.5" />;
  if (tone === 'teal') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (tone === 'amber') return <Clock3 className="h-3.5 w-3.5" />;
  return <Gauge className="h-3.5 w-3.5" />;
}

function metricVisual(metric: DashboardMetric, index: number, metrics: DashboardMetric[]): ReactNode {
  const numericValue = typeof metric.value === 'number' ? metric.value : Number.parseFloat(metric.value);
  const numericMetrics = metrics.map((entry) => typeof entry.value === 'number' ? entry.value : Number.parseFloat(entry.value)).filter(Number.isFinite);
  const maximum = Math.max(1, ...numericMetrics);
  const percent = String(metric.value).includes('%')
    ? Math.min(100, Math.max(0, numericValue || 0))
    : Math.min(100, Math.max(8, (numericValue || 0) / maximum * 100));

  if (index === 0) {
    return (
      <svg viewBox="0 0 120 22" preserveAspectRatio="none" className="h-5 w-full text-primary-600 dark:text-primary-300">
        <path d="M0 17 L14 13 L28 15 L43 8 L58 12 L73 7 L88 10 L104 4 L120 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }

  if (index === 1) {
    return (
      <span className="flex h-5 items-end gap-0.5">
        {[28, 45, 36, 62, 48, 76, 96].map((height, barIndex) => (
          <span key={barIndex} className={`min-w-0 flex-1 ${barIndex > 4 ? TONE[metric.tone].bar : 'bg-primary-200 dark:bg-primary-700'}`} style={{ height: `${height}%` }} />
        ))}
      </span>
    );
  }

  return (
    <span className="block h-1.5 bg-slate-100 dark:bg-slate-700">
      <span className={`block h-full ${TONE[metric.tone].bar}`} style={{ width: `${percent}%` }} />
    </span>
  );
}

function cardStatus(card: DashboardCard): { label: string; tone: StatusTone } {
  if (card.overdue > 0) return { label: `เกินกำหนด ${card.overdue.toLocaleString('th-TH')}`, tone: 'danger' };
  if (card.warning > 0) return { label: `ใกล้กำหนด ${card.warning.toLocaleString('th-TH')}`, tone: 'warning' };
  return { label: 'ปกติ', tone: 'success' };
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
  const exportDashboard = () => {
    if (!dashboard.data) return;
    downloadCsv([
      ['แหล่งข้อมูล', 'รายการ', 'สถานะ', 'ครบกำหนด', 'คงเหลือ'],
      ...dashboard.data.upcoming.map((item) => [
        item.source,
        item.title,
        item.status,
        formatThaiDate(item.dueAt, 'd MMM yyyy'),
        dashboardDueLabel(item.daysRemaining),
      ]),
    ], `dashboard-follow-up-${dashboard.data.generatedAt.slice(0, 10)}.csv`);
  };

  return (
    <div className="space-y-3" data-testid="dashboard-page">
      <section className="rounded-[13px] border border-hairline bg-white px-5 py-5 shadow-card dark:border-white/[.08] dark:bg-white/[.035] sm:px-[26px] sm:py-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-primary-700 dark:text-primary-300">{copy.eyebrow} · {formatThaiDate(new Date().toISOString(), 'd MMM yyyy')}</p>
            <h1 className="mt-3 text-[30px] font-extrabold leading-[1.22] text-ink-heading [text-wrap:pretty] dark:text-[#e8eef9] sm:text-[40px]">
              วันนี้มี <span className={dashboard.data?.alertCount ? 'text-danger-700 dark:text-red-300' : 'text-primary-700 dark:text-primary-300'}>{dashboard.data?.alertCount ?? '—'} เรื่อง</span> ที่ควรจัดการก่อนงานอื่น
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 dark:text-white/45">สวัสดี {me?.profile.full_name?.split(' ')[0] ?? 'ผู้ใช้งาน'} — {copy.title} พร้อมสรุปสิ่งที่ทำต่อได้จากข้อมูลจริงตามสิทธิ์ของคุณ</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/my-work"><Button size="sm">เปิดศูนย์งาน</Button></Link>
            <Link to="/tickets"><Button size="sm" variant="secondary">ดูคิว Ticket</Button></Link>
            <Button size="sm" variant="outline" onClick={exportDashboard} disabled={!dashboard.data || dashboard.data.upcoming.length === 0}><Download className="h-4 w-4" aria-hidden="true" />ส่งออกรายงาน</Button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-hairline-row pt-3 dark:border-white/[.07]">
          <div className="flex rounded-[8px] bg-surface-muted p-0.5 dark:bg-white/[.07]" role="group" aria-label="ช่วงติดตามล่วงหน้า">
            {LEAD_OPTIONS.map((option) => (
              <button key={option.value} type="button" onClick={() => setLeadDays(option.value)} aria-pressed={leadDays === option.value} className={`min-h-8 min-w-14 rounded-[6px] px-3 text-[11.5px] font-semibold ${leadDays === option.value ? 'bg-white text-primary-700 shadow-sm dark:bg-white/[.1] dark:text-primary-300' : 'text-slate-500 hover:text-primary-700 dark:text-white/45'}`}>{option.label}</button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => void dashboard.refetch()} disabled={dashboard.isFetching}><RefreshCw className={`h-4 w-4 ${dashboard.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />รีเฟรช</Button>
          <span className="ml-auto font-mono text-[9px] text-slate-400">ข้อมูลตามสิทธิ์ของ {me?.profile.full_name ?? 'ผู้ใช้งาน'}</span>
        </div>
      </section>

      {dashboard.isLoading && <LoadingState label="กำลังโหลด Dashboard" rows={7} />}
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
          <div
            className={`flex flex-col gap-2 rounded-card border px-4 py-3 text-sm shadow-card sm:flex-row sm:items-center sm:justify-between ${dashboard.data.alertCount > 0 ? 'border-danger-100 bg-danger-50 text-danger-700 dark:border-danger-700 dark:bg-danger-700/20 dark:text-danger-100' : 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/40 dark:text-primary-200'}`}
            role={dashboard.data.alertCount > 0 ? 'alert' : 'status'}
          >
            <span className="flex items-start gap-2">
              {dashboard.data.alertCount > 0
                ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
              <span>
                {dashboard.data.alertCount > 0
                  ? `มี ${dashboard.data.alertCount.toLocaleString('th-TH')} จุดที่ต้องติดตามเร่งด่วน รวมรายการเกินกำหนดและ Incident ระดับสูง/วิกฤต`
                  : 'ไม่พบรายการเร่งด่วนจากข้อมูลที่ท่านมีสิทธิ์เข้าถึง'}
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold">ดูข้อมูลภายใน {dashboard.data.leadDays} วัน</span>
          </div>

          <KpiStrip
            label="ตัวชี้วัดสำคัญ"
            variant="executive"
            items={dashboard.data.metrics.map((metric, index) => ({
              key: `${metric.label}-${index}`,
              label: metric.label,
              value: metric.value,
              note: metric.note,
              icon: metricIcon(metric.tone),
              href: metric.path,
              visual: metricVisual(metric, index, dashboard.data.metrics),
            }))}
          />

          {dashboard.data.executiveAnalytics && <ExecutiveServiceAnalytics data={dashboard.data.executiveAnalytics} />}

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
            <Card className="overflow-hidden">
              <CardHeader className="flex items-center justify-between gap-3">
                <span>สุขภาพงานควบคุมเชิงปฏิบัติการ</span>
                <span className="text-xs font-normal text-slate-400">ตามสิทธิ์ของบัญชี</span>
              </CardHeader>
              {dashboard.data.cards.length > 0 ? (
                <div className="grid gap-px bg-slate-200 dark:bg-slate-700 sm:grid-cols-2 lg:grid-cols-3">
                  {dashboard.data.cards.map((card) => (
                    <Link
                      key={card.key}
                      to={card.path}
                      className="group relative min-h-[92px] bg-white px-3 py-2.5 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400 dark:bg-slate-800 dark:hover:bg-slate-700"
                    >
                      <span className={`absolute inset-y-0 left-0 w-1 ${TONE[card.tone].bar}`} aria-hidden="true" />
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{card.label}</span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-600" aria-hidden="true" />
                      </span>
                      <span className="mt-1.5 block text-xl font-extrabold text-slate-900 dark:text-white">{card.total.toLocaleString('th-TH')}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge display={cardStatus(card)} />
                        {card.truncated && <span className="text-[11px] text-slate-400">นับสถานะจาก {card.scanned.toLocaleString('th-TH')} รายการล่าสุด</span>}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <CardBody>
                  <EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="ไม่มีข้อมูลควบคุม" message="บัญชีนี้ยังไม่มีแหล่งข้อมูลที่เข้าถึงได้" />
                </CardBody>
              )}
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className="flex items-center justify-between gap-3">
                <span>สัดส่วนงานสำคัญ</span>
                <span className="text-xs font-normal text-slate-400">Top 6 ต่อกลุ่ม</span>
              </CardHeader>
              <CardBody className="space-y-4">
                {dashboard.data.breakdowns.map((breakdown) => {
                  const values = breakdown.items.map((entry) => entry.value);
                  const maximum = Math.max(1, ...values);
                  return (
                    <section key={breakdown.key} aria-labelledby={`breakdown-${breakdown.key}`}>
                      <h3 id={`breakdown-${breakdown.key}`} className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{breakdown.label}</h3>
                      {breakdown.items.length > 0 ? (
                        <div className="space-y-2">
                          {breakdown.items.slice(0, 6).map((item) => (
                            <div key={item.label} className="grid grid-cols-[minmax(76px,1fr)_2fr_36px] items-center gap-2 text-xs">
                              <span className="truncate" title={item.label}>{item.label}</span>
                              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" role="progressbar" aria-label={`${item.label} ${item.value}`} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={item.value}>
                                <div className="h-full rounded-full bg-primary-600" style={{ width: `${dashboardBarWidth(item.value, values)}%` }} />
                              </div>
                              <span className="text-right font-bold text-slate-700 dark:text-slate-200">{item.value.toLocaleString('th-TH')}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-slate-400">ไม่มีข้อมูล</p>}
                    </section>
                  );
                })}
              </CardBody>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <span>กำหนดการที่ต้องติดตาม</span>
              <span className="text-xs font-normal text-slate-400">เกินกำหนดก่อน · แสดงสูงสุด 30 รายการ</span>
            </CardHeader>
            {dashboard.data.upcoming.length > 0 ? (
              <DataTable tableId="dashboard-upcoming" toolbar={false} pagination={false} className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                  <tr>
                    <th className="px-4 py-3 font-semibold">แหล่งข้อมูล/รายการ</th>
                    <th className="px-4 py-3 font-semibold">สถานะ</th>
                    <th className="px-4 py-3 font-semibold">ครบกำหนด</th>
                    <th className="px-4 py-3 text-right font-semibold">คงเหลือ</th>
                    <th className="px-4 py-3 text-right font-semibold">เปิด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {dashboard.data.upcoming.map((item) => (
                    <tr key={`${item.source}-${item.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="px-4 py-3">
                        <span className="block font-semibold text-slate-800 dark:text-slate-100">{item.title}</span>
                        <span className="mt-0.5 block text-xs text-primary-700 dark:text-primary-300">{item.source}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">{item.status || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1"><CalendarClock className="h-4 w-4" aria-hidden="true" />{formatThaiDate(item.dueAt, 'd MMM yyyy')}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <StatusBadge display={{ label: dashboardDueLabel(item.daysRemaining), tone: STATUS_TONE[item.tone] }} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={item.path} className="inline-flex min-h-10 items-center gap-1 px-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 dark:text-primary-300 dark:hover:bg-slate-700">
                          ดูรายการ<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <CardBody>
                <EmptyState
                  icon={<ClipboardList className="h-9 w-9" />}
                  title="ไม่มีรายการใกล้หรือเกินกำหนด"
                  message={`ไม่พบกำหนดการภายในช่วง ${dashboard.data.leadDays} วันที่เลือก`}
                />
              </CardBody>
            )}
          </Card>

          <p className="text-right text-xs text-slate-400">
            <BarChart3 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            อัปเดตล่าสุด {formatThaiDateTime(dashboard.data.generatedAt)}
          </p>
        </>
      )}
    </div>
  );
}
