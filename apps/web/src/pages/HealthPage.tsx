import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useHealth } from '../hooks/useHealth';
import { formatThaiDate } from '../utils/date';

/** Public health surface: intentionally contains no environment or infrastructure details. */
export function HealthPage() {
  const { data, isLoading, isError, error } = useHealth();

  return (
    <main className="life-public flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
        <ShieldCheck className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-700 dark:text-primary-300">LIFE IT</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-800 dark:text-slate-100">สถานะบริการ</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Public Health Check</p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-slate-500" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>กำลังตรวจสอบสถานะบริการ...</span>
        </div>
      )}

      {isError && (
        <div className="flex max-w-md items-center gap-2 rounded-md bg-red-50 px-4 py-3 text-left text-sm text-red-700 dark:bg-red-950 dark:text-red-300" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>บริการอาจไม่พร้อมใช้งานในขณะนี้ ({error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'})</span>
        </div>
      )}

      {data && (
        <div className={`flex max-w-md flex-col items-center gap-1 rounded-md px-4 py-3 text-sm ${data.status === 'ok' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
          <div className="flex items-center gap-2 font-medium">
            {data.status === 'ok' ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            <span>{data.status === 'ok' ? 'บริการพร้อมใช้งาน' : 'บริการทำงานได้บางส่วน'}</span>
          </div>
          <span>ตรวจสอบเมื่อ {formatThaiDate(data.timestamp, 'd MMMM yyyy HH:mm')} น. · {data.responseTimeMs} ms</span>
        </div>
      )}

      <p className="max-w-md text-xs leading-5 text-slate-400">หน้านี้แสดงเฉพาะข้อมูลที่ปลอดภัยสำหรับการตรวจสอบสาธารณะ</p>
      <Link to="/" className="public-link text-sm">กลับหน้าหลัก</Link>
    </main>
  );
}
