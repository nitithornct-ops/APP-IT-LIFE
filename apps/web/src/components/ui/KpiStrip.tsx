import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

export interface KpiStripItem {
  key: string;
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  ariaLabel?: string;
  visual?: ReactNode;
}

function KpiContent({ item, variant }: { item: KpiStripItem; variant: 'default' | 'executive' }) {
  if (variant === 'executive') {
    return (
      <>
        <span className="flex items-start justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-white/45">{item.label}</span>
          {item.icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300" aria-hidden="true">{item.icon}</span>}
        </span>
        <span className="mt-2 block font-mono text-[22px] font-bold leading-none text-ink-heading dark:text-[#e8eef9]">{item.value}</span>
        {item.note && <span className="mt-1 block min-h-4 text-[10px] text-slate-400 dark:text-slate-500">{item.note}</span>}
        {item.visual && <span className="mt-auto block pt-3" aria-hidden="true">{item.visual}</span>}
      </>
    );
  }
  return (
    <>
      {item.icon && <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300" aria-hidden="true">{item.icon}</span>}
      <span className="min-w-0">
        <span className="block font-mono text-[22px] font-bold leading-none text-ink-heading dark:text-[#e8eef9]">{item.value}</span>
        <span className="mt-1 block text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">{item.label}</span>
        {item.note && <span className="mt-0.5 block text-[11px] text-slate-400 dark:text-slate-500">{item.note}</span>}
      </span>
    </>
  );
}

/** KPI แบบแถบเดียว เซลล์กว้างเท่ากันและยุบเป็นหนึ่งเซลล์ต่อแถวเมื่อจอแคบกว่า 420px */
export function KpiStrip({
  items,
  label = 'สรุปข้อมูล',
  variant = 'default',
}: {
  items: KpiStripItem[];
  label?: string;
  variant?: 'default' | 'executive';
}) {
  return (
    <section
      className="grid grid-cols-1 gap-[9px] min-[420px]:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]"
      aria-label={label}
    >
      {items.map((item) => {
        const className = cn(
          variant === 'executive'
            ? 'flex min-h-[124px] w-full flex-col rounded-card border border-hairline bg-white px-4 py-4 text-left shadow-card transition-[border-color,box-shadow,transform] dark:border-white/[.08] dark:bg-white/[.035]'
            : 'flex min-h-[76px] w-full items-center gap-3 rounded-card border border-hairline bg-white px-3 py-2.5 text-left shadow-card transition-[border-color,box-shadow,transform] dark:border-white/[.08] dark:bg-white/[.035]',
          (item.href || item.onClick) && 'hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 dark:hover:bg-slate-700',
          item.active && 'border-primary-300 bg-primary-50 dark:bg-slate-700',
        );
        const ariaLabel = item.ariaLabel ?? `${item.label}: ${String(item.value)}`;

        if (item.href) {
          return <Link key={item.key} to={item.href} className={className} aria-label={ariaLabel}><KpiContent item={item} variant={variant} /></Link>;
        }
        if (item.onClick) {
          return <button key={item.key} type="button" onClick={item.onClick} className={className} aria-label={ariaLabel} aria-pressed={item.active}><KpiContent item={item} variant={variant} /></button>;
        }
        return <div key={item.key} className={className}><KpiContent item={item} variant={variant} /></div>;
      })}
    </section>
  );
}
