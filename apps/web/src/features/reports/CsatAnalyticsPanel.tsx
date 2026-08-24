import { MessageSquareText, Star, TrendingUp, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import type { ReportDataset } from '../../types/reports';
import { formatThaiDateTime } from '../../utils/date';

type CsatAnalytics = NonNullable<ReportDataset['csat']>;

function scoreTone(score: number) {
  if (score >= 4.5) return 'text-teal-600 dark:text-teal-300';
  if (score >= 4) return 'text-primary-600 dark:text-primary-300';
  if (score >= 3) return 'text-amber-600 dark:text-amber-300';
  return 'text-red-600 dark:text-red-300';
}

export function CsatAnalyticsPanel({ data }: { data: CsatAnalytics }) {
  const trendMaximum = Math.max(1, ...data.weeklyTrend.map((point) => point.average ?? 0));
  const mentionMaximum = Math.max(1, ...data.mentions.map((item) => item.count));

  return (
    <section className="space-y-4" aria-labelledby="csat-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-600 dark:text-primary-300">Customer satisfaction</p>
          <h2 id="csat-title" className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">ความพึงพอใจจาก Ticket จริง</h2>
        </div>
        <p className="text-xs text-slate-500">คำนวณจากแบบประเมิน {data.responseCount.toLocaleString('th-TH')} รายการในช่วงที่เลือก</p>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)_280px]">
        <article className="rounded-[10px] bg-[#0b1b36] p-5 text-white shadow-card">
          <div className="flex items-center justify-between"><span className="text-xs font-semibold text-white/60">คะแนนเฉลี่ย</span><Star className="h-5 w-5 fill-amber-300 text-amber-300" aria-hidden="true" /></div>
          <p className="mt-2 font-mono text-[40px] font-extrabold leading-none">{data.average === null ? '—' : data.average.toFixed(2)}</p>
          <p className="mt-1 text-xs text-white/50">จากคะแนนเต็ม 5</p>
          <div className="mt-5 space-y-2">
            {data.distribution.map((item) => (
              <div key={item.score} className="grid grid-cols-[34px_1fr_42px] items-center gap-2 text-[10px]">
                <span className="font-mono text-white/70">{item.score} ★</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-amber-300" style={{ width: `${item.percentage}%` }} /></span>
                <span className="text-right font-mono text-white/50">{item.count}</span>
              </div>
            ))}
          </div>
        </article>

        <Card>
          <CardHeader className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary-600" />แนวโน้ม 12 สัปดาห์</CardHeader>
          <CardBody>
            <div className="flex h-48 items-end gap-2 border-b border-slate-200 px-1 dark:border-slate-700">
              {data.weeklyTrend.map((point) => (
                <div key={point.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="font-mono text-[10px] font-semibold text-slate-500">{point.average?.toFixed(1) ?? '—'}</span>
                  <span title={`${point.label}: ${point.average?.toFixed(2) ?? 'ไม่มีคำตอบ'} (${point.responses} คำตอบ)`} className={`w-full max-w-6 rounded-t ${point.average === null ? 'bg-slate-100 dark:bg-slate-700' : point.average < 3 ? 'bg-red-500' : point.average < 4 ? 'bg-amber-500' : 'bg-primary-600'}`} style={{ height: point.average === null ? '4px' : `${Math.max(8, (point.average / trendMaximum) * 138)}px` }} />
                  <span className="w-full truncate text-center font-mono text-[10px] text-slate-400">{point.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-slate-400">แท่งสีแดงคือสัปดาห์ที่คะแนนเฉลี่ยต่ำกว่า 3</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>คะแนนแยกหมวด</CardHeader>
          <CardBody className="space-y-3">
            {data.categories.length ? data.categories.slice(0, 7).map((item) => (
              <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_44px] gap-2 text-xs">
                <div className="min-w-0"><p className="truncate font-semibold text-slate-700 dark:text-slate-200" title={item.label}>{item.label}</p><p className="text-[10px] text-slate-400">{item.responses} คำตอบ</p></div>
                <span className={`text-right font-mono text-sm font-extrabold ${scoreTone(item.average)}`}>{item.average.toFixed(2)}</span>
              </div>
            )) : <p className="text-sm text-slate-400">ยังไม่มีคะแนนแยกหมวด</p>}
          </CardBody>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader className="flex items-center justify-between gap-2"><span>คิวต้องตามแก้</span><span className="rounded-full bg-red-50 px-2 py-1 font-mono text-[10px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">{data.followUpCount} รายการ</span></CardHeader>
          <CardBody className="space-y-0 p-0">
            {data.followUps.length ? data.followUps.map((item) => (
              <article key={item.id || item.code} className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-700 sm:grid-cols-[92px_minmax(0,1fr)_auto]">
                <div><p className="font-mono text-[10px] font-bold text-primary-700 dark:text-primary-300">{item.code}</p><p className="mt-1 font-mono text-[10px] text-slate-400">{formatThaiDateTime(item.submittedAt)}</p></div>
                <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{item.title}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.feedback || 'ผู้ใช้ไม่ได้ฝากความคิดเห็น'}</p><p className="mt-1 text-[10px] text-slate-400">ผู้รับผิดชอบ: {item.owner || '—'}</p></div>
                <div className="flex items-center gap-2 sm:flex-col sm:items-end"><span className="rounded-md bg-red-50 px-2 py-1 font-mono text-xs font-extrabold text-red-700 dark:bg-red-950/40 dark:text-red-300">{item.rating}/5</span>{item.id && <Link to={`/tickets/${item.id}`} className="text-[10px] font-bold text-primary-700 hover:underline dark:text-primary-300">เปิด Ticket</Link>}</div>
              </article>
            )) : <div className="p-8 text-center"><MessageSquareText className="mx-auto h-8 w-8 text-teal-500" /><p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">ไม่มีคะแนนต่ำที่ต้องตามแก้</p><p className="mt-1 text-xs text-slate-400">เมื่อมีคะแนน 1–3 ดาว รายการจะเข้าคิวนี้อัตโนมัติ</p></div>}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>คำที่พูดถึงบ่อย</CardHeader>
            <CardBody className="flex flex-wrap gap-2">
              {data.mentions.length ? data.mentions.map((item) => <span key={item.label} className="rounded-full bg-primary-50 px-2.5 py-1 font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-300" style={{ fontSize: `${10.5 + (item.count / mentionMaximum) * 4}px` }}>{item.label} <span className="font-mono opacity-60">{item.count}</span></span>) : <p className="text-sm text-slate-400">ยังไม่มีความคิดเห็นสำหรับสรุปคำ</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader className="flex items-center gap-2"><UserRound className="h-4 w-4 text-primary-600" />ช่างคะแนนสูง</CardHeader>
            <CardBody className="space-y-3">
              {data.technicians.length ? data.technicians.map((item, index) => <div key={item.label} className="flex items-center gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-50 font-mono text-[10px] font-bold text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{item.label}</span><span className="text-[10px] text-slate-400">{item.responses} คำตอบ</span></span><strong className={`font-mono text-sm ${scoreTone(item.average)}`}>{item.average.toFixed(2)}</strong></div>) : <p className="text-sm text-slate-400">ยังไม่มีข้อมูลคะแนนรายช่าง</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </section>
  );
}
