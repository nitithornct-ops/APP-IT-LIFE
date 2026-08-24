import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

type Variant = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'teal' | 'purple' | 'secondary';

const variantClasses: Record<Variant, string> = {
  primary: 'border border-primary-200 bg-primary-100 text-primary-800 dark:border-primary-700 dark:bg-primary-900/40 dark:text-primary-200',
  success: 'border border-success-100 bg-success-50 text-success-700 dark:border-success-700 dark:bg-success-700/20 dark:text-success-100',
  warning: 'border border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-700 dark:bg-warning-700/20 dark:text-warning-100',
  danger: 'border border-danger-100 bg-danger-50 text-danger-700 dark:border-danger-700 dark:bg-danger-700/20 dark:text-danger-100',
  info: 'border border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
  teal: 'border border-transparent bg-teal-50 text-teal-600 dark:bg-teal-700/30 dark:text-teal-100',
  purple: 'border border-transparent bg-purple-50 text-purple-600 dark:bg-purple-700/30 dark:text-purple-100',
  secondary: 'border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200',
};

export function Badge({ variant = 'secondary', children }: { variant?: Variant; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] px-[7px] py-0.5 text-[10.5px] font-semibold leading-4',
        variantClasses[variant],
      )}
    >
      {children}
    </span>
  );
}
