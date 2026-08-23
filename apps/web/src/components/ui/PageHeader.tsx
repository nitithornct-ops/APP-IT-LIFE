import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface PageHeaderProps {
  eyebrow: ReactNode;
  title: ReactNode;
  description: ReactNode;
  meta?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  leading?: ReactNode;
  variant?: 'default' | 'hero';
}

/**
 * ส่วนหัวมาตรฐานของหน้าภายในระบบ โดยจงใจรับ primary action เพียงหนึ่งช่อง
 * เพื่อให้ทุกหน้ามีจุดเริ่มงานหลักตำแหน่งเดียวกัน
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  primaryAction,
  secondaryActions,
  leading,
  variant = 'default',
}: PageHeaderProps) {
  return (
    <header className={cn('life-page-header flex flex-col justify-between gap-3 lg:flex-row lg:items-center', variant === 'hero' && 'life-page-header--hero')}>
      <div className="flex min-w-0 items-start gap-3">
        {leading && (
          <span className={cn('mt-0.5 grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-primary-200 bg-primary-100 text-primary-700 dark:border-primary-700 dark:bg-primary-900/40 dark:text-primary-200', variant === 'hero' && 'border-white/20 bg-white/10 text-white')} aria-hidden="true">
            {leading}
          </span>
        )}
        <div className="min-w-0">
          <p className="life-page-eyebrow font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-700 dark:text-primary-300">{eyebrow}</p>
          <h1 className="mt-0.5 text-[22px] font-extrabold text-ink-heading dark:text-[#e8eef9]">{title}</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] text-slate-500 dark:text-white/45">{description}</p>
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
      </div>
      {(secondaryActions || primaryAction) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}
