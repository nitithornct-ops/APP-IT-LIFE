import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, CircleGauge, Clock3, Loader2, PauseCircle, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { SlaImpactCounts, SlaImpactResponse, SystemSetting } from '../../types/settings';

const DAY_LABELS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const SLA_KEYS = ['SLA_BUSINESS_START', 'SLA_BUSINESS_END', 'SLA_BUSINESS_DAYS', 'SLA_HOLIDAYS'] as const;

function errorText(reason: unknown): string {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : 'คำนวณผลกระทบ SLA ไม่สำเร็จ';
}

function buildPreviewPath(values: Record<string, string>): string {
  const query = new URLSearchParams();
  for (const key of SLA_KEYS) query.set(key, values[key] ?? '');
  return `/api/v1/settings/sla-impact?${query.toString()}`;
}

function ImpactMetric({
  label,
  current,
  proposed,
  tone,
  icon,
}: {
  label: string;
  current: number;
  proposed: number;
  tone: string;
  icon: React.ReactNode;
}) {
  const delta = proposed - current;
  return <div className={`rounded-xl border p-3 ${tone}`}>
    <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{label}</span>{icon}</div>
    <p className="mt-2 font-mono text-2xl font-extrabold">{proposed}</p>
    <p className="mt-1 text-[11px] opacity-75">ปัจจุบัน {current}{delta ? ` · ${delta > 0 ? '+' : ''}${delta}` : ' · ไม่เปลี่ยน'}</p>
  </div>;
}

function metricProps(counts: SlaImpactCounts, key: keyof Pick<SlaImpactCounts, 'overdue' | 'critical' | 'atRisk' | 'safe'>) {
  return counts[key];
}

export function SlaImpactPanel({ data }: { data: SlaImpactResponse }) {
  const workHours = data.calendar.minutesPerDay / 60;
  return <Card className="overflow-hidden" data-testid="sla-settings-overview">
    <CardHeader className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900/30">
      <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary-600" /><div><p>SLA & เวลาทำการ</p><p className="text-xs font-normal text-slate-500">จำลองจาก Ticket เปิดและ SLA ของหมวดงานจริง</p></div></div>
      <span className="rounded-full bg-teal-100 px-2.5 py-1 text-[11px] font-bold text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">ข้อมูลคิวจริง</span>
    </CardHeader>
    <CardBody className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(330px,.85fr)]">
      <div className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="text-xs font-bold text-slate-500">เวลาทำการฉบับร่าง</p>
            <p className="mt-1 font-mono text-xl font-extrabold text-slate-900 dark:text-white">{data.calendar.start}–{data.calendar.end}</p>
            <p className="mt-1 text-xs text-slate-500">{Number.isInteger(workHours) ? workHours : workHours.toFixed(1)} ชั่วโมงต่อวัน · ไม่นับนอกเวลาทำการ</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{DAY_LABELS.map((label, day) => <span key={day} className={`grid h-7 min-w-7 place-items-center rounded-md px-1 text-[11px] font-bold ${data.calendar.businessDays.includes(day) ? 'bg-primary-700 text-white' : 'bg-slate-100 text-slate-400 dark:bg-slate-700'}`}>{label}</span>)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="text-xs font-bold text-slate-500">วันหยุดที่ไม่นับ SLA</p>
            {data.calendar.holidays.length ? <div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">{data.calendar.holidays.map((holiday) => <span key={holiday} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-200">{holiday}</span>)}</div> : <p className="mt-2 text-sm text-slate-400">ยังไม่ได้กำหนดวันหยุด</p>}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between bg-slate-50 px-3 py-2 dark:bg-slate-900/40"><p className="text-xs font-bold text-slate-600 dark:text-slate-300">SLA ตามหมวดงาน</p><span className="text-[11px] text-slate-400">{data.policies.length} หมวดที่เปิดใช้</span></div>
          <div className="max-h-52 overflow-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="sticky top-0 bg-white text-slate-400 dark:bg-slate-800"><tr><th className="px-3 py-2 font-semibold">หมวดงาน</th><th className="px-3 py-2 font-semibold">Priority</th><th className="px-3 py-2 text-right font-semibold">ตอบรับ</th><th className="px-3 py-2 text-right font-semibold">แก้ไขเสร็จ</th></tr></thead>
              <tbody>{data.policies.map((policy) => <tr key={policy.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">{policy.name}</td><td className="px-3 py-2.5 text-slate-500">{policy.priority}</td><td className="px-3 py-2.5 text-right font-mono">{policy.responseHours} ชม.</td><td className="px-3 py-2.5 text-right font-mono font-bold">{policy.resolutionHours} ชม.</td></tr>)}</tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="text-xs font-bold text-slate-500">Escalation timeline</p>
          <div className="relative mt-4 grid grid-cols-3 gap-2 before:absolute before:left-[16.7%] before:right-[16.7%] before:top-3 before:h-0.5 before:bg-slate-200 dark:before:bg-slate-700">
            {[['70%', 'เริ่มเสี่ยง', 'bg-amber-500'], ['90%', 'วิกฤต', 'bg-orange-500'], ['100%', 'เกิน SLA', 'bg-red-600']].map(([percent, label, color]) => <div key={percent} className="relative text-center"><span className={`relative z-10 mx-auto grid h-6 w-6 place-items-center rounded-full text-[9px] font-bold text-white ${color}`}>{percent.replace('%', '')}</span><p className="mt-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</p><p className="font-mono text-[10px] text-slate-400">{percent}</p></div>)}
          </div>
        </div>
      </div>

      <aside className="rounded-2xl border border-primary-200 bg-primary-50/70 p-4 dark:border-primary-900 dark:bg-primary-950/20">
        <div className="flex items-start gap-2"><CircleGauge className="mt-0.5 h-5 w-5 text-primary-700 dark:text-primary-300" /><div><h3 className="font-extrabold text-slate-900 dark:text-white">ถ้าบันทึกค่าชุดนี้</h3><p className="mt-0.5 text-xs text-slate-500">ผลต่อ Ticket เปิด {data.proposed.total} รายการ</p></div></div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <ImpactMetric label="เกิน SLA" current={metricProps(data.current, 'overdue')} proposed={metricProps(data.proposed, 'overdue')} tone="border-red-200 bg-white text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" icon={<ShieldAlert className="h-4 w-4" />} />
          <ImpactMetric label="วิกฤต ≥90%" current={metricProps(data.current, 'critical')} proposed={metricProps(data.proposed, 'critical')} tone="border-orange-200 bg-white text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200" icon={<AlertTriangle className="h-4 w-4" />} />
          <ImpactMetric label="เสี่ยง ≥70%" current={metricProps(data.current, 'atRisk')} proposed={metricProps(data.proposed, 'atRisk')} tone="border-amber-200 bg-white text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" icon={<Clock3 className="h-4 w-4" />} />
          <ImpactMetric label="ปลอดภัย" current={metricProps(data.current, 'safe')} proposed={metricProps(data.proposed, 'safe')} tone="border-teal-200 bg-white text-teal-700 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200" icon={<CheckCircle2 className="h-4 w-4" />} />
        </div>
        <div className="mt-3 space-y-2 rounded-xl border border-primary-100 bg-white/80 p-3 text-xs dark:border-primary-900 dark:bg-slate-900/60">
          <p className="flex items-center justify-between gap-3"><span className="text-slate-500">กำหนดเสร็จเปลี่ยน</span><strong className="font-mono text-slate-800 dark:text-white">{data.changes.deadlineChanged}</strong></p>
          <p className="flex items-center justify-between gap-3"><span className="text-slate-500">เกิน SLA เพิ่มทันที</span><strong className={`font-mono ${data.changes.newlyOverdue ? 'text-red-600' : 'text-teal-600'}`}>{data.changes.newlyOverdue}</strong></p>
          <p className="flex items-center justify-between gap-3"><span className="text-slate-500">เข้าสู่กลุ่มเสี่ยงใหม่</span><strong className={`font-mono ${data.changes.newlyAtRisk ? 'text-amber-600' : 'text-teal-600'}`}>{data.changes.newlyAtRisk}</strong></p>
          <p className="flex items-center justify-between gap-3"><span className="flex items-center gap-1 text-slate-500"><PauseCircle className="h-3.5 w-3.5" />กำลังพัก SLA</span><strong className="font-mono text-slate-800 dark:text-white">{data.proposed.paused}</strong></p>
        </div>
        {data.proposed.unconfigured > 0 && <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">มี {data.proposed.unconfigured} Ticket ที่ไม่มี SLA ครบ จึงไม่รวมในระดับความเสี่ยง</p>}
        {data.changes.preservedReopened > 0 && <p className="mt-3 text-[11px] leading-5 text-slate-500">Ticket ที่เคยเปิดซ้ำ {data.changes.preservedReopened} รายการใช้กำหนดจริงเดิม เพราะระบบเดิมไม่ได้เก็บเวลาเริ่มรอบล่าสุดแยกต่างหาก</p>}
        <p className="mt-3 text-[10px] text-slate-400">คำนวณล่าสุด {new Date(data.generatedAt).toLocaleString('th-TH')}</p>
      </aside>
    </CardBody>
  </Card>;
}

export function SlaSettingsOverview({ settings, drafts }: { settings: SystemSetting[]; drafts: Record<string, string> }) {
  const values = useMemo(() => Object.fromEntries(SLA_KEYS.map((key) => [key, drafts[key] ?? settings.find((item) => item.key === key)?.value ?? ''])), [drafts, settings]);
  const serialized = useMemo(() => JSON.stringify(values), [values]);
  const [debouncedValues, setDebouncedValues] = useState(values);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValues(JSON.parse(serialized) as Record<string, string>), 350);
    return () => window.clearTimeout(timer);
  }, [serialized]);

  const impactQuery = useQuery({
    queryKey: ['admin', 'settings', 'sla-impact', debouncedValues],
    queryFn: () => apiFetch<SlaImpactResponse>(buildPreviewPath(debouncedValues), undefined, { silent: true }),
    enabled: SLA_KEYS.every((key) => key === 'SLA_HOLIDAYS' || Boolean(debouncedValues[key])),
    staleTime: 30_000,
  });

  if (impactQuery.isLoading) return <Card><CardBody className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-primary-600" />กำลังคำนวณผลกระทบ SLA จากคิวจริง...</CardBody></Card>;
  if (impactQuery.isError) return <Card className="border-red-200 dark:border-red-900"><CardBody className="flex gap-2 text-sm text-red-700 dark:text-red-200"><AlertTriangle className="h-5 w-5 shrink-0" /><div><p className="font-bold">ยังคำนวณผลกระทบ SLA ไม่ได้</p><p className="mt-1 text-xs">{errorText(impactQuery.error)}</p></div></CardBody></Card>;
  return impactQuery.data ? <SlaImpactPanel data={impactQuery.data} /> : null;
}
