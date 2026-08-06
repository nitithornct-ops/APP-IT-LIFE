import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useHealth } from '../hooks/useHealth';
import { formatThaiDate } from '../utils/date';

export function HealthPage() {
  const { data, isLoading, isError, error } = useHealth();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">สถานะระบบ (Health Check)</h1>

      {isLoading && (
        <div className="flex items-center gap-2 text-slate-500" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>กำลังตรวจสอบสถานะ API...</span>
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>เชื่อมต่อ API ไม่สำเร็จ: {error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}</span>
        </div>
      )}

      {data && (
        <div
          className={`flex flex-col items-center gap-1 rounded-md px-4 py-3 text-sm ${
            data.status === 'ok'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {data.status === 'ok' ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            )}
            <span>
              API {data.status === 'ok' ? 'พร้อมใช้งาน' : 'ทำงานได้บางส่วน (ฐานข้อมูลมีปัญหา)'} ({data.environment})
            </span>
          </div>
          <span>ฐานข้อมูล: {data.checks.database === 'ok' ? 'เชื่อมต่อได้' : 'เชื่อมต่อไม่ได้'}</span>
          <span>ตรวจสอบล่าสุด: {formatThaiDate(data.timestamp, 'd MMMM yyyy HH:mm')} น.</span>
        </div>
      )}

      <Link to="/" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
        กลับหน้าแรก
      </Link>
    </main>
  );
}
