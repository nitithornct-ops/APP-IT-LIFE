import { FilterX, Search } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { Button } from './Button';

export const filterControlClass = 'h-9 min-w-0 rounded-[7px] border border-hairline-control bg-white px-3 text-xs text-slate-700 dark:border-white/[.12] dark:bg-white/[.035] dark:text-slate-100';

export interface QuickFilter {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

export interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  onSubmit?: () => void;
  filters?: ReactNode;
  quickFilters?: QuickFilter[];
  onClear: () => void;
  activeFilterCount?: number;
  actions?: ReactNode;
  resultCount?: number;
  itemLabel?: string;
  className?: string;
}

/** Filter bar แบบ controlled เพื่อใช้ query/filter เดิมได้ทั้ง client และ server-side table */
export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'ค้นหาทุกคอลัมน์...',
  searchLabel = 'ค้นหาในรายการ',
  onSubmit,
  filters,
  quickFilters = [],
  onClear,
  activeFilterCount = 0,
  actions,
  resultCount,
  itemLabel = 'รายการ',
  className,
}: FilterBarProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit?.();
  }

  return (
    <form
      className={cn('rounded-card border border-hairline bg-white p-3 shadow-card dark:border-white/[.08] dark:bg-white/[.035]', className)}
      onSubmit={handleSubmit}
      role="search"
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <label className="relative min-w-0 flex-1 xl:max-w-sm">
          <span className="sr-only">{searchLabel}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            className="h-9 w-full rounded-[7px] border border-hairline-control bg-surface-header pl-9 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100 dark:border-white/[.12] dark:bg-white/[.035] dark:text-slate-100 dark:focus:ring-primary-900/40"
          />
        </label>
        {filters && <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap">{filters}</div>}
        <button type="submit" className="sr-only">ค้นหา</button>
        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
          {actions}
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={activeFilterCount === 0}>
            <FilterX className="h-4 w-4" aria-hidden="true" />
            ล้างตัวกรอง{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
          {resultCount !== undefined && (
            <span className="rounded-[5px] border border-hairline bg-surface-header px-3 py-1.5 font-mono text-[10px] font-semibold text-slate-500 dark:border-white/[.08] dark:bg-white/[.035] dark:text-slate-300" role="status">
              {resultCount.toLocaleString('th-TH')} {itemLabel}
            </span>
          )}
        </div>
      </div>
      {quickFilters.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="ตัวกรองด่วน">
          {quickFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={filter.onClick}
              aria-pressed={filter.active}
              className={cn(
                'min-h-8 rounded-[6px] border px-3 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                filter.active
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-primary-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
