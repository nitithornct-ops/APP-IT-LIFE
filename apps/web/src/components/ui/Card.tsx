import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

type CardProps = HTMLAttributes<HTMLDivElement> & { 'data-ui'?: string };

export function Card({ className, 'data-ui': dataUi = 'card', ...rest }: CardProps) {
  return (
    <div
      data-ui={dataUi}
      className={cn(
        'rounded-card border border-hairline bg-white shadow-card transition-[border-color,box-shadow,transform] duration-150 dark:border-white/[.08] dark:bg-white/[.035]',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'border-b border-hairline-row px-4 py-3 font-bold text-ink-heading dark:border-white/[.07] dark:text-[#e8eef9]',
        className,
      )}
      {...rest}
    />
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-4', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-b-card border-t border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40',
        className,
      )}
      {...rest}
    />
  );
}

export function StatCard({
  icon,
  label,
  value,
  note,
  tone = 'primary',
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  note?: string;
  tone?: 'primary' | 'teal' | 'amber' | 'danger' | 'gray';
}) {
  const toneClasses: Record<string, { icon: string; border: string; surface: string }> = {
    primary: { icon: 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300', border: 'border-t-primary-500', surface: 'bg-white dark:bg-slate-800' },
    teal: { icon: 'bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-100', border: 'border-t-success-600', surface: 'bg-white dark:bg-slate-800' },
    amber: { icon: 'bg-warning-50 text-warning-700 dark:bg-warning-700/20 dark:text-warning-100', border: 'border-t-warning-600', surface: 'bg-white dark:bg-slate-800' },
    danger: { icon: 'bg-danger-50 text-danger-700 dark:bg-danger-700/20 dark:text-danger-100', border: 'border-t-danger-600', surface: 'bg-white dark:bg-slate-800' },
    gray: { icon: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200', border: 'border-t-slate-400', surface: 'bg-white dark:bg-slate-800' },
  };

  return (
    <Card data-ui="stat" className={cn('flex min-h-[116px] items-center gap-3 border-t-2 p-4', toneClasses[tone].border, toneClasses[tone].surface)}>
      <div className={cn('flex h-10 w-10 min-w-10 items-center justify-center rounded-xl', toneClasses[tone].icon)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[22px] font-bold leading-tight text-ink-heading dark:text-[#e8eef9]">{value}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</p>
        {note && <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">{note}</p>}
      </div>
    </Card>
  );
}
