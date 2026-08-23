import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Loader2, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { apiFetch } from '../../services/apiClient';
import type { PmRosterPlan, PmRosterResponse } from '../../types/assets';
import { formatThaiDate } from '../../utils/date';

function dateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function mondayOf(date: Date): string {
  const key = dateKey(date);
  const localNoon = new Date(`${key}T12:00:00+07:00`);
  const day = localNoon.getUTCDay();
  localNoon.setUTCDate(localNoon.getUTCDate() - (day === 0 ? 6 : day - 1));
  return dateKey(localNoon);
}

function moveWeek(weekStart: string, amount: number): string {
  const date = new Date(`${weekStart}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount * 7);
  return date.toISOString().slice(0, 10);
}

function endOfWeek(weekStart: string): string {
  const date = new Date(`${weekStart}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('') || 'IT';
}

function planTone(plan: PmRosterPlan): string {
  if (plan.status === 'ดำเนินการแล้ว') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200';
  if (plan.status === 'กำลังดำเนินการ') return 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-950/30 dark:text-primary-200';
  return 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

export function PmRosterPanel({ data }: { data: PmRosterResponse }) {
  const maximum = Math.max(1, ...data.technicians.map((person) => person.total));
  const today = dateKey(new Date());
  return <div className="space-y-4" data-testid="pm-roster-panel">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        ['งานในสัปดาห์', data.summary.total, 'text-primary-700 dark:text-primary-300'],
        ['มอบหมายแล้ว', data.summary.assigned, 'text-teal-700 dark:text-teal-300'],
        ['ยังไม่มอบหมาย', data.summary.unassigned, data.summary.unassigned ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'],
        ['เสร็จแล้ว', data.summary.completed, 'text-teal-700 dark:text-teal-300'],
        ['ค้างจากก่อนหน้า', data.summary.overdue, data.summary.overdue ? 'text-red-700 dark:text-red-300' : 'text-slate-500'],
      ].map(([label, value, tone]) => <Card key={String(label)} className="p-3"><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className={`mt-1 font-mono text-2xl font-extrabold ${tone}`}>{value}</p></Card>)}
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-primary-600" /><span>ภาระงาน PM รายช่าง</span></div><span className="text-[11px] font-normal text-slate-400">จำนวนงานต่อวัน · ไม่ใช้ค่าความจุสมมติ</span></CardHeader>
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[190px_repeat(7,minmax(82px,1fr))_100px] border-b border-slate-200 bg-slate-50 text-center dark:border-slate-700 dark:bg-slate-900/40">
              <div className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">ผู้รับผิดชอบ</div>
              {data.days.map((day) => <div key={day.date} className={`border-l border-slate-200 px-2 py-2 dark:border-slate-700 ${day.date === today ? 'bg-primary-50 dark:bg-primary-950/30' : ''}`}><p className="font-mono text-[10px] font-bold text-slate-500">{day.label}</p><p className={`mt-0.5 font-mono text-[10px] ${day.date === today ? 'text-primary-700 dark:text-primary-300' : 'text-slate-400'}`}>{formatThaiDate(day.date, 'd MMM')}</p></div>)}
              <div className="border-l border-slate-200 px-2 py-2 font-mono text-[10px] font-bold text-slate-500 dark:border-slate-700">รวม</div>
            </div>
            {data.technicians.map((person) => <div key={person.id} className="grid min-h-[86px] grid-cols-[190px_repeat(7,minmax(82px,1fr))_100px] border-b border-slate-100 last:border-0 dark:border-slate-700">
              <div className="flex min-w-0 items-center gap-2 px-3 py-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-100 text-[10px] font-bold text-primary-700 dark:bg-primary-900/50 dark:text-primary-200">{initials(person.name)}</span><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-700 dark:text-slate-200">{person.name}</p><p className="mt-0.5 text-[10px] text-slate-400">{person.inProgress ? `กำลังทำ ${person.inProgress}` : person.overdue ? `ค้าง ${person.overdue}` : 'ตามแผน'}</p></div></div>
              {data.days.map((day, index) => {
                const plans = person.plans.filter((plan) => plan.planDate === day.date);
                return <div key={day.date} className={`min-w-0 border-l border-slate-100 p-1.5 dark:border-slate-700 ${day.date === today ? 'bg-primary-50/40 dark:bg-primary-950/10' : ''}`}>{plans.map((plan) => <div key={plan.id} title={`${plan.assetCode} · ${plan.assetName}`} className={`mb-1 truncate rounded border px-1.5 py-1 text-[9px] font-semibold last:mb-0 ${planTone(plan)}`}>{plan.assetCode || 'PM'} · {plan.assetName}</div>)}{!plans.length && person.dayCounts[index] === 0 && <span className="grid h-full place-items-center text-[10px] text-slate-300">—</span>}</div>;
              })}
              <div className="border-l border-slate-100 p-2 text-center dark:border-slate-700"><p className="font-mono text-lg font-extrabold text-slate-800 dark:text-white">{person.total}</p><div className="mx-auto mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-primary-600" style={{ width: `${person.total / maximum * 100}%` }} /></div>{person.overdue > 0 && <p className="mt-1 text-[9px] font-semibold text-red-600">ค้าง {person.overdue}</p>}</div>
            </div>)}
            {!data.technicians.length && <div className="grid min-h-40 place-items-center text-sm text-slate-400">ยังไม่มีงานที่มอบหมายให้ช่างในสัปดาห์นี้</div>}
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex items-center gap-2"><CircleDashed className="h-4 w-4 text-amber-600" />งานยังไม่มอบหมาย</CardHeader>
          <CardBody className="space-y-2">{data.unassignedPlans.slice(0, 6).map((plan) => <div key={plan.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950/30"><p className="truncate text-xs font-bold text-amber-900 dark:text-amber-100">{plan.assetCode} · {plan.assetName}</p><p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">{formatThaiDate(plan.planDate, 'EEE d MMM')} · {plan.recurrence}</p></div>)}{!data.unassignedPlans.length && <p className="flex items-center gap-2 text-xs text-teal-700 dark:text-teal-300"><CheckCircle2 className="h-4 w-4" />งานสัปดาห์นี้มีผู้รับผิดชอบครบ</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-600" />งาน PM ที่เลยกำหนด</span><span className="font-mono text-xs font-normal text-red-600">{data.summary.overdue}</span></CardHeader>
          <CardBody className="space-y-2">{data.overduePlans.slice(0, 6).map((plan) => <div key={plan.id} className="border-l-2 border-red-500 pl-2"><p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{plan.assetCode} · {plan.assetName}</p><p className="mt-0.5 text-[10px] text-slate-400">{plan.technicianName} · ค้าง {plan.overdueDays} วัน</p></div>)}{!data.overduePlans.length && <p className="text-xs text-slate-400">ไม่มีงาน PM เกินกำหนด</p>}{data.overdueSampled && <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">ยอดรวมมาจากฐานข้อมูลทั้งหมด รายชื่อแสดงเฉพาะ 1,000 รายการแรก</p>}</CardBody>
        </Card>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] leading-5 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"><strong>ขอบเขตข้อมูล:</strong> ตารางนี้ใช้แผน PM และผู้รับผิดชอบจริง ระบบยังไม่มีข้อมูลเวรรับสาย วันลา และ Change window จึงยังไม่รวมสามส่วนดังกล่าว</div>
      </div>
    </div>
  </div>;
}

export function PmRosterView() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const query = useQuery({ queryKey: ['maintenance-plans', 'roster', weekStart], queryFn: () => apiFetch<PmRosterResponse>(`/api/v1/maintenance-plans/roster?weekStart=${weekStart}`) });
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
      <div><p className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><CalendarRange className="h-4 w-4 text-primary-600" />สัปดาห์ {formatThaiDate(weekStart, 'd MMM')}–{formatThaiDate(endOfWeek(weekStart), 'd MMM yyyy')}</p><p className="mt-1 text-[11px] text-slate-400">ตารางกำลังคนจากแผน PM ที่มอบหมายจริง</p></div>
      <div className="flex gap-1"><Button size="sm" variant="outline" aria-label="สัปดาห์ก่อนหน้า" onClick={() => setWeekStart((current) => moveWeek(current, -1))}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={() => setWeekStart(mondayOf(new Date()))}>สัปดาห์นี้</Button><Button size="sm" variant="outline" aria-label="สัปดาห์ถัดไป" onClick={() => setWeekStart((current) => moveWeek(current, 1))}><ChevronRight className="h-4 w-4" /></Button></div>
    </div>
    {query.isLoading && <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-primary-600" />กำลังโหลดตารางกำลังคน PM...</div>}
    {query.isError && <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">โหลดตารางกำลังคน PM ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</div>}
    {query.data && <div className="p-4"><PmRosterPanel data={query.data} /></div>}
  </div>;
}
