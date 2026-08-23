import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

export function EmptyState({
  icon,
  title,
  message,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  message?: string;
  /** Alias used by feature-level empty states. */
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center" role="status" aria-live="polite">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-primary-50 text-primary-500 dark:bg-primary-900/35 dark:text-primary-300">{icon}</div>
      <p className="font-bold text-slate-700 dark:text-slate-200">{title}</p>
      {(message ?? description) && <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{message ?? description}</p>}
      <div className="mt-2">
        {action ?? (
          <a href="/" className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-hairline-control bg-white px-3 text-xs font-semibold text-primary-700 hover:bg-primary-50 dark:border-white/[.12] dark:bg-white/[.04] dark:text-primary-300">
            กลับไปหน้าหลัก <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}
