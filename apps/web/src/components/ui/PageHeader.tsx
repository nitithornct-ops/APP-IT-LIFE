import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { PageTitle } from './PageTitle';

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
      <PageTitle eyebrow={eyebrow} title={title} description={description} meta={meta} leading={leading} variant={variant} />
      {(secondaryActions || primaryAction) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}
