import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Skeleton } from './Skeleton';

export function LoadingState({
  label = 'กำลังโหลดข้อมูล...',
  delayMs = 180,
  rows = 5,
}: {
  label?: string;
  delayMs?: number;
  rows?: number;
}) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div className="space-y-3 px-4 py-5" role="status" aria-label={label}>
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {label}
      </div>
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
    </div>
  );
}

export function ErrorState({
  title = 'โหลดข้อมูลไม่สำเร็จ',
  message = 'กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง',
  onRetry,
  isRetrying,
  action,
  code,
  requestId,
  draftNotice,
}: {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  isRetrying?: boolean;
  action?: ReactNode;
  /** รหัสความผิดพลาด เช่น HTTP 504 หรือรหัสของระบบ */
  code?: string;
  /** REQ id ของคำขอนั้น — ผู้ใช้แจ้งเลขนี้ให้ผู้ดูแลตามเรื่องใน log ได้ตรงคำขอ */
  requestId?: string;
  /**
   * ข้อความยืนยันว่าสิ่งที่ผู้ใช้กรอกไว้ไม่หาย — ส่งมาเฉพาะหน้าที่เก็บร่างไว้จริงเท่านั้น
   * ห้ามตั้งเป็นค่าเริ่มต้น เพราะการบอกว่าเก็บร่างแล้วทั้งที่ไม่ได้เก็บ ทำให้ผู้ใช้ปิดหน้าจอแล้วงานหาย
   */
  draftNotice?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 border border-danger-100 bg-danger-50 px-6 py-10 text-center dark:border-danger-700 dark:bg-danger-700/20" role="alert">
      <AlertTriangle className="h-8 w-8 text-danger-700 dark:text-danger-100" aria-hidden="true" />
      <p className="font-bold text-danger-700 dark:text-danger-100">{title}</p>
      <p className="max-w-md text-sm text-slate-600 dark:text-slate-300">{message}</p>
      {draftNotice && <p className="max-w-md text-[12px] text-slate-600 dark:text-slate-300">{draftNotice}</p>}
      {(code || requestId) && (
        <p className="max-w-md font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
          {code && <span>รหัส {code}</span>}
          {code && requestId && <span aria-hidden="true"> · </span>}
          {requestId && <span>REQ {requestId}</span>}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button variant="outline" onClick={onRetry} isLoading={isRetrying}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              ลองใหม่
            </Button>
          )}
          {action ?? (!onRetry && (
            <a href="/" className="inline-flex min-h-10 items-center rounded-[7px] border border-danger-100 bg-white px-4 text-sm font-semibold text-danger-700 hover:bg-danger-50 dark:border-white/[.12] dark:bg-white/[.04] dark:text-red-300">
              กลับไปหน้าหลัก
            </a>
          ))}
        </div>
    </div>
  );
}
