import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800',
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
        'border-b border-slate-100 px-5 py-3.5 font-bold text-slate-800 dark:border-slate-700 dark:text-slate-100',
        className,
      )}
      {...rest}
    />
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-b-2xl border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-900/40',
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
  const toneClasses: Record<string, string> = {
    primary: 'bg-primary-600',
    teal: 'bg-teal-700',
    amber: 'bg-amber-600',
    danger: 'bg-red-600',
    gray: 'bg-slate-500',
  };

  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={cn('flex h-11 w-11 min-w-[2.75rem] items-center justify-center rounded-xl text-white', toneClasses[tone])}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold leading-tight text-slate-800 dark:text-slate-100">{value}</p>
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</p>
        {note && <p className="text-xs text-slate-400 dark:text-slate-500">{note}</p>}
      </div>
    </Card>
  );
}
