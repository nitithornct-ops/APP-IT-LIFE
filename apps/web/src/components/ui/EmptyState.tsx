import type { ReactNode } from 'react';

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
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-slate-300 dark:text-slate-600">{icon}</div>
      <p className="font-bold text-slate-700 dark:text-slate-200">{title}</p>
      {(message ?? description) && <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{message ?? description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
