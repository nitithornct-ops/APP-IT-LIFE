import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800',
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
        'border-b border-slate-100 px-4 py-3 font-bold text-slate-800 dark:border-slate-700 dark:text-slate-100',
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
        'rounded-b-lg border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40',
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
  const toneClasses: Record<string, { icon: string; border: string }> = {
    primary: { icon: 'bg-primary-600', border: 'border-b-primary-500' },
    teal: { icon: 'bg-teal-700', border: 'border-b-teal-600' },
    amber: { icon: 'bg-amber-600', border: 'border-b-amber-500' },
    danger: { icon: 'bg-red-600', border: 'border-b-red-500' },
    gray: { icon: 'bg-slate-500', border: 'border-b-slate-500' },
  };

  return (
    <Card className={cn('flex min-h-[84px] items-center gap-3 border-b-2 p-3', toneClasses[tone].border)}>
      <div className={cn('flex h-10 w-10 min-w-10 items-center justify-center rounded-lg text-white', toneClasses[tone].icon)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight text-slate-800 dark:text-slate-100">{value}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</p>
        {note && <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">{note}</p>}
      </div>
    </Card>
  );
}
