import { Activity, CheckCircle2, Clock3, MessageSquareHeart, TimerReset } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import type { ExecutiveServiceAnalytics as Analytics } from '../../types/dashboard';

const HEAT_COLORS = ['#EEF1F7', '#DCE6F9', '#CFDDF7', '#8FB0EE', '#4B7BE0', '#173A8A'];
const STATUS_COLORS = ['#1D4ED8', '#4B7BE0', '#D97706', '#F2CF9C', '#0F766E', '#94A3B8'];
const AGE_COLORS = ['#1D4ED8', '#4B7BE0', '#D97706', '#DC2626'];

function valueOrDash(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toLocaleString('th-TH')}${suffix}`;
}

function heatColor(value: number, maximum: number): string {
  if (!value || !maximum) return HEAT_COLORS[0];
  return HEAT_COLORS[Math.max(1, Math.min(5, Math.ceil(value / maximum * 5)))];
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.slice(0, 1)).join('').toLocaleUpperCase('th') || 'IT';
}

function Kpi({ label, value, note, icon, tone = 'default' }: { label: string; value: string; note: string; icon: ReactNode; tone?: 'default' | 'success' | 'dark' }) {
  const classes = tone === 'dark'
    ? 'border-primary-950 bg-primary-950 text-white'
    : tone === 'success'
      ? 'border-emerald-200 bg-white text-emerald-700 dark:border-emerald-900 dark:bg-slate-800 dark:text-emerald-300'
      : 'border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  return <div className={`rounded-xl border p-3 ${classes}`}>
    <div className="flex items-center justify-between gap-2"><p className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${tone === 'dark' ? 'text-white/55' : 'text-slate-500'}`}>{label}</p>{icon}</div>
    <p className="mt-2 font-mono text-2xl font-extrabold leading-none">{value}</p>
    <p className={`mt-2 text-[11px] ${tone === 'dark' ? 'text-white/55' : 'text-slate-500'}`}>{note}</p>
  </div>;
}

export function ExecutiveServiceAnalytics({ data }: { data: Analytics }) {
  const openTotal = data.openByStatus.reduce((sum, item) => sum + item.value, 0);
  const ageMaximum = Math.max(1, ...data.backlogAge.map((item) => item.value));
  const categoryMaximum = Math.max(1, ...data.categories.map((item) => item.value));

  return <section className="space-y-3" aria-labelledby="executive-service-title" data-testid="executive-service-analytics">
    <div className="flex flex-wrap items-end justify-between gap-2 px-1">
      <div><p className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-primary-700 dark:text-primary-300">Service performance · {data.periodDays} วัน</p><h2 id="executive-service-title" className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">ภาพรวมงานบริการ IT</h2></div>
      {data.sampled && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">ข้อมูลเกินขีดจำกัด · วิเคราะห์จากรายการล่าสุด</span>}
    </div>

    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <Kpi label="รับแจ้งในช่วงนี้" value={data.kpis.received.toLocaleString('th-TH')} note={`Ticket ที่สร้างใน ${data.periodDays} วัน`} icon={<Activity className="h-4 w-4 text-primary-600" />} />
      <Kpi label="ปิดงานตาม SLA" value={valueOrDash(data.kpis.slaClosedPercent, '%')} note="เฉพาะใบที่มี Due date" icon={<CheckCircle2 className="h-4 w-4" />} tone="success" />
      <Kpi label="เวลารับเรื่องเฉลี่ย" value={valueOrDash(data.kpis.averageResponseMinutes)} note="นาทีแบบ elapsed time" icon={<Clock3 className="h-4 w-4 text-primary-600" />} />
      <Kpi label="เวลาปิดงานเฉลี่ย" value={valueOrDash(data.kpis.averageResolutionHours)} note="ชั่วโมงแบบ elapsed time" icon={<TimerReset className="h-4 w-4 text-amber-600" />} />
      <Kpi label="ความพึงพอใจ" value={valueOrDash(data.kpis.csatAverage)} note={`${data.kpis.csatResponses.toLocaleString('th-TH')} แบบประเมิน · เต็ม 5`} icon={<MessageSquareHeart className="h-4 w-4 text-white/70" />} tone="dark" />
    </div>

    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,1fr)_minmax(300px,1fr)]">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-wrap items-baseline justify-between gap-2"><span>ช่วงเวลาที่งานเข้า</span><span className="text-[11px] font-normal text-slate-400">จำนวนใบต่อชั่วโมง · 7 วันล่าสุด</span></CardHeader>
        <CardBody>
          <div className="overflow-x-auto pb-1"><div className="min-w-[490px]">
            <div className="grid grid-cols-[30px_repeat(12,minmax(24px,1fr))] gap-1">
              <span />
              {data.heatmap.hours.map((hour) => <span key={hour} className="text-center font-mono text-[9px] text-slate-400">{String(hour).padStart(2, '0')}</span>)}
              {data.heatmap.days.flatMap((day) => [
                <span key={`${day.key}-label`} className="flex items-center justify-end pr-1 font-mono text-[10px] text-slate-400">{day.label}</span>,
                ...day.values.map((value, index) => <span key={`${day.key}-${data.heatmap.hours[index]}`} title={`${day.key} ${String(data.heatmap.hours[index]).padStart(2, '0')}:00 · ${value} ใบ`} aria-label={`${day.key} เวลา ${data.heatmap.hours[index]} นาฬิกา ${value} ใบ`} className="aspect-square rounded-[3px] border border-white/25" style={{ backgroundColor: heatColor(value, data.heatmap.maximum) }} />),
              ])}
            </div>
          </div></div>
          <div className="mt-4 border-t border-dashed border-slate-200 pt-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {data.heatmap.peak ? <>ช่วงพีคจริงอยู่วัน <strong>{data.heatmap.peak.dayLabel}</strong> เวลา <strong className="font-mono">{String(data.heatmap.peak.hour).padStart(2, '0')}:00–{String(data.heatmap.peak.hour + 1).padStart(2, '0')}:00</strong> จำนวน {data.heatmap.peak.count} ใบ</> : 'ยังไม่มี Ticket ในช่วง 08:00–19:59 ของ 7 วันล่าสุด'}
          </div>
          <div className="mt-3 flex items-center gap-1.5 font-mono text-[9px] text-slate-400"><span>น้อย</span>{HEAT_COLORS.map((color) => <span key={color} className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: color }} />)}<span>มาก</span></div>
        </CardBody>
      </Card>

      <div className="space-y-3">
        <Card className="overflow-hidden">
          <CardHeader className="flex items-center justify-between"><span>งานค้างตามสถานะ</span><span className="font-mono text-xs font-normal text-slate-400">{openTotal} ใบ</span></CardHeader>
          <CardBody>
            {openTotal > 0 && <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">{data.openByStatus.map((item, index) => <span key={item.label} style={{ width: `${item.value / openTotal * 100}%`, backgroundColor: STATUS_COLORS[index % STATUS_COLORS.length] }} />)}</div>}
            <div className="mt-3 space-y-2">{data.openByStatus.map((item, index) => <div key={item.label} className="flex items-center gap-2 text-xs"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: STATUS_COLORS[index % STATUS_COLORS.length] }} /><span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{item.label}</span><strong className="font-mono text-slate-800 dark:text-white">{item.value}</strong></div>)}{!data.openByStatus.length && <p className="text-xs text-slate-400">ไม่มี Ticket ค้าง</p>}</div>
          </CardBody>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader className="flex items-center justify-between"><span>อายุงานค้าง</span><span className="font-mono text-xs font-normal text-slate-400">{openTotal} ใบ</span></CardHeader>
          <CardBody><div className="flex h-28 items-end gap-2">{data.backlogAge.map((item, index) => <div key={item.key} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center"><strong className={`font-mono text-xs ${item.key === 'over7' && item.value ? 'text-red-600' : 'text-slate-700 dark:text-slate-200'}`}>{item.value}</strong><span className="mx-auto mt-1 w-full max-w-12 rounded-t" style={{ height: `${Math.max(item.value ? 10 : 2, item.value / ageMaximum * 70)}px`, backgroundColor: AGE_COLORS[index] }} /><span className="mt-1 whitespace-nowrap font-mono text-[9px] text-slate-400">{item.label}</span></div>)}</div></CardBody>
        </Card>
      </div>

      <div className="space-y-3">
        <Card className="overflow-hidden">
          <CardHeader>หมวดที่แจ้งมากที่สุด</CardHeader>
          <CardBody className="space-y-3">{data.categories.map((item, index) => <div key={item.label}><div className="flex justify-between gap-2 text-xs"><span className="truncate text-slate-600 dark:text-slate-300">{item.label}</span><strong className="font-mono text-slate-800 dark:text-white">{item.value}</strong></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full" style={{ width: `${item.value / categoryMaximum * 100}%`, backgroundColor: HEAT_COLORS[Math.min(5, 5 - index)] }} /></div></div>)}{!data.categories.length && <p className="text-xs text-slate-400">ไม่มีข้อมูลในช่วงที่เลือก</p>}</CardBody>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader className="flex items-baseline justify-between gap-2"><span>ทีมช่างในช่วงนี้</span><span className="text-[10px] font-normal text-slate-400">ปิดงาน · SLA · คะแนน</span></CardHeader>
          <div className="divide-y divide-slate-100 px-4 dark:divide-slate-700">{data.technicians.map((person) => <div key={person.name} className="grid grid-cols-[minmax(0,1fr)_38px_48px_34px] items-center gap-2 py-2.5 text-xs"><div className="flex min-w-0 items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-100 text-[9px] font-bold text-primary-700 dark:bg-primary-900/50 dark:text-primary-200">{initials(person.name)}</span><span className="truncate font-semibold text-slate-700 dark:text-slate-200">{person.name}</span></div><span className="text-right font-mono font-bold">{person.closed}</span><span className={`text-right font-mono font-semibold ${person.slaPercent !== null && person.slaPercent < 90 ? 'text-amber-600' : 'text-teal-600'}`}>{valueOrDash(person.slaPercent, '%')}</span><span className="text-right font-mono">{valueOrDash(person.averageRating)}</span></div>)}{!data.technicians.length && <p className="py-5 text-center text-xs text-slate-400">ยังไม่มีงานที่ปิดโดยทีมช่างในช่วงนี้</p>}</div>
        </Card>
      </div>
    </div>
  </section>;
}
