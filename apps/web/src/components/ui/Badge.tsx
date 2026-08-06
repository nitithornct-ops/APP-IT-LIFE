import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

type Variant = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'secondary';

const variantClasses: Record<Variant, string> = {
  primary: 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  info: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
  secondary: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

export function Badge({ variant = 'secondary', children }: { variant?: Variant; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        variantClasses[variant],
      )}
    >
      {children}
    </span>
  );
}
