import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface ToastMessage {
  message: string;
  tone: 'success' | 'error';
}

const GLOBAL_TOAST_EVENT = 'itlife:toast';

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const close = useCallback(() => setToast(null), []);

  useEffect(() => {
    const handleToast = (event: Event) => setToast((event as CustomEvent<ToastMessage>).detail);
    window.addEventListener(GLOBAL_TOAST_EVENT, handleToast);
    return () => window.removeEventListener(GLOBAL_TOAST_EVENT, handleToast);
  }, []);

  return <>{children}<Toast toast={toast} onClose={close} /></>;
}

export function Toast({ toast, onClose }: { toast: ToastMessage | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onClose, 4_000);
    return () => window.clearTimeout(timer);
  }, [onClose, toast]);

  if (!toast) return null;
  const Icon = toast.tone === 'success' ? CheckCircle2 : AlertTriangle;

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      data-ui="toast"
      className={cn(
        'fixed bottom-20 right-4 z-[200] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border bg-white px-4 py-3 text-sm shadow-elevated dark:bg-slate-800 sm:bottom-4 sm:max-w-sm',
        toast.tone === 'success'
          ? 'border-emerald-200 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200'
          : 'border-red-200 text-red-700 dark:border-red-800 dark:text-red-200',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="ปิดข้อความแจ้งเตือน" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-primary-50 dark:hover:bg-slate-700">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
