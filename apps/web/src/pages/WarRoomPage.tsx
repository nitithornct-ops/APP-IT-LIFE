import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, RadioTower, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState } from '../components/ui/AsyncState';
import { QueryError } from '../components/ui/QueryError';
import { apiFetch } from '../services/apiClient';
import { useForcedTheme } from '../stores/themeContext';
import type { DashboardSummary, DashboardTone } from '../types/dashboard';
import { formatThaiDateTime } from '../utils/date';

const toneClass: Record<DashboardTone, { text: string; border: string; surface: string; bar: string }> = {
  primary: { text: 'text-blue-300', border: 'border-blue-400/30', surface: 'from-blue-400/[.14]', bar: 'bg-blue-400' },
  teal: { text: 'text-emerald-300', border: 'border-emerald-400/30', surface: 'from-emerald-400/[.14]', bar: 'bg-emerald-400' },
  amber: { text: 'text-amber-300', border: 'border-amber-400/30', surface: 'from-amber-400/[.14]', bar: 'bg-amber-400' },
  danger: { text: 'text-red-300', border: 'border-red-400/30', surface: 'from-red-400/[.14]', bar: 'bg-red-400' },
  gray: { text: 'text-slate-300', border: 'border-white/10', surface: 'from-white/[.07]', bar: 'bg-slate-400' },
};

export function WarRoomPage() {
  // 4a กำหนดให้จอนี้เป็นโหมดมืดเสมอ ไม่ขึ้นกับธีมที่ผู้ใช้เลือก — บังคับที่ระดับ root ไม่ใช่แค่กล่องของหน้า
  // ไม่งั้น Topbar สูง 46px จะยังขาวอยู่ กลายเป็นแถบสว่างคาดอยู่เหนือจอดำ
  useForcedTheme('dark');
  const [now, setNow] = useState(() => new Date());
  const dashboard = useQuery({
    queryKey: ['dashboard', 'war-room'],
    queryFn: () => apiFetch<DashboardSummary>('/api/v1/dashboard/summary?leadDays=7'),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="-m-3 min-h-[calc(100vh-46px)] bg-[#060d1c] p-4 text-[#e8eef9] sm:-mx-[18px] sm:-my-4 sm:p-[18px]" data-testid="war-room-page">
      <header className="flex min-h-[60px] flex-wrap items-center gap-4 border-b border-white/[.07] pb-3">
        <span className="grid h-9 w-9 place-items-center rounded-[9px] bg-blue-600 text-sm font-extrabold text-white shadow-[0_4px_12px_rgba(29,78,216,.4)]">L</span>
        <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-white/35">LIFE IT OPERATIONS</p><h1 className="text-lg font-extrabold">War Room</h1></div>
        <span className="ml-auto inline-flex items-center gap-2 rounded-[5px] border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(74,222,128,.2)]" />ระบบหลักอยู่ในการติดตาม</span>
        <time className="font-mono text-base font-semibold tabular-nums text-white/70">{now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        <button type="button" onClick={() => void dashboard.refetch()} className="grid h-9 w-9 place-items-center rounded-[7px] border border-white/10 text-white/45 hover:bg-white/[.07] hover:text-white" aria-label="รีเฟรช War Room"><RefreshCw className={`h-4 w-4 ${dashboard.isFetching ? 'animate-spin' : ''}`} /></button>
      </header>

      {dashboard.isLoading && <LoadingState label="กำลังดึงสถานการณ์ล่าสุด..." rows={7} />}
      {dashboard.isError && <QueryError title="โหลดข้อมูล War Room ไม่สำเร็จ" error={dashboard.error} onRetry={() => void dashboard.refetch()} isRetrying={dashboard.isFetching} />}
      {dashboard.data && <div className="mt-4 grid gap-3 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-3">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="ตัวชี้วัด War Room">
            {dashboard.data.metrics.slice(0, 4).map((metric, index) => {
              const tone = toneClass[metric.tone];
              return <Link key={`${metric.label}-${index}`} to={metric.path ?? '/reports'} className={`flex min-h-[136px] flex-col rounded-[10px] border bg-gradient-to-b ${tone.surface} to-white/[.03] p-4 ${tone.border}`}>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-white/35">{metric.label}</span>
                <span className={`mt-3 font-mono text-[40px] font-extrabold leading-none ${tone.text}`}>{metric.value}</span>
                <span className="mt-2 text-xs text-white/45">{metric.note}</span>
                <span className="mt-auto flex h-5 items-end gap-1 pt-3" aria-hidden="true">{[26, 44, 36, 62, 48, 76, 92].map((height, bar) => <span key={bar} className={`flex-1 rounded-t-[2px] ${bar === 6 ? tone.bar : 'bg-white/10'}`} style={{ height: `${height}%` }} />)}</span>
              </Link>;
            })}
          </section>

          <section className="overflow-hidden rounded-[10px] border border-white/[.08] bg-white/[.028]">
            <div className="flex items-center gap-2 border-b border-white/[.07] px-4 py-3"><AlertTriangle className="h-4 w-4 text-amber-300" /><h2 className="font-bold">ต้องลงมือตอนนี้</h2><span className="ml-auto font-mono text-[10px] text-white/35">AUTO REFRESH 30 SEC</span></div>
            <div className="grid h-8 grid-cols-[96px_1fr_132px_128px_104px] items-center gap-3 border-b border-white/[.07] bg-white/[.025] px-4 font-mono text-[10px] font-semibold uppercase tracking-[.08em] text-white/35"><span>กำหนด</span><span>รายการ</span><span>แหล่งงาน</span><span>สถานะ</span><span className="text-right">คงเหลือ</span></div>
            {dashboard.data.upcoming.slice(0, 10).map((item) => {
              const urgent = item.daysRemaining < 0;
              return <Link key={`${item.source}-${item.id}`} to={item.path} className="grid min-h-14 grid-cols-[96px_1fr_132px_128px_104px] items-center gap-3 border-b border-white/[.07] px-4 last:border-0 hover:bg-white/[.04]">
                <span className="font-mono text-[11px] text-white/45">{new Date(item.dueAt).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}</span>
                <span className="min-w-0"><span className="block truncate text-[13px] font-semibold text-white/85">{item.title}</span><span className="font-mono text-[9px] text-white/30">{item.id}</span></span>
                <span className="truncate text-xs text-white/55">{item.source}</span>
                <span className="text-xs text-white/55">{item.status}</span>
                <span className={`text-right font-mono text-[15px] font-bold ${urgent ? 'text-red-300' : item.daysRemaining <= 2 ? 'text-amber-300' : 'text-emerald-300'}`}>{urgent ? `เกิน ${Math.abs(item.daysRemaining)} วัน` : `${item.daysRemaining} วัน`}</span>
              </Link>;
            })}
            {dashboard.data.upcoming.length === 0 && <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-center"><ShieldCheck className="h-8 w-8 text-emerald-300" /><p className="font-semibold">ไม่มีรายการเร่งด่วน</p><Link to="/my-work" className="text-xs font-semibold text-blue-300 hover:underline">เปิดศูนย์งานของฉัน</Link></div>}
          </section>
        </main>

        <aside className="space-y-3">
          <section className="rounded-[10px] border border-white/[.08] bg-white/[.028] p-4"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-300" /><h2 className="font-bold">สุขภาพบริการ</h2></div><div className="mt-4 space-y-3">{dashboard.data.cards.slice(0, 6).map((card) => <Link key={card.key} to={card.path} className="flex items-center gap-3"><span className={`h-2 w-2 rounded-full ${card.overdue > 0 ? 'bg-red-400' : card.warning > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} /><span className="min-w-0 flex-1 truncate text-xs text-white/65">{card.label}</span><span className="font-mono text-[10px] text-white/35">{card.total}</span></Link>)}</div></section>
          <section className="rounded-[10px] border border-white/[.08] bg-white/[.028] p-4"><div className="flex items-center gap-2"><RadioTower className="h-4 w-4 text-blue-300" /><h2 className="font-bold">ฟีดความเคลื่อนไหว</h2></div><div className="mt-4 space-y-4">{dashboard.data.upcoming.slice(0, 5).map((item) => <Link key={`feed-${item.source}-${item.id}`} to={item.path} className="block border-l border-white/10 pl-3"><p className="line-clamp-2 text-xs text-white/65">{item.title}</p><p className="mt-1 font-mono text-[9px] text-white/30">{item.source} · {item.status}</p></Link>)}</div></section>
          <section className="rounded-[10px] border border-emerald-400/25 bg-gradient-to-b from-emerald-400/[.14] to-emerald-400/[.03] p-4"><p className="font-mono text-[10px] font-semibold uppercase tracking-[.1em] text-emerald-300">สรุปสถานการณ์</p><p className="mt-2 text-sm leading-6 text-white/70">มี {dashboard.data.alertCount.toLocaleString('th-TH')} จุดที่ต้องติดตามใน 7 วันข้างหน้า เปิดรายการเพื่อมอบหมายหรือบันทึกการดำเนินงานได้ทันที</p><Link to="/my-work" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-300">ไปศูนย์งาน <ArrowRight className="h-3.5 w-3.5" /></Link></section>
          <p className="text-right font-mono text-[9px] text-white/25">อัปเดต {formatThaiDateTime(dashboard.data.generatedAt)}</p>
        </aside>
      </div>}
    </div>
  );
}
