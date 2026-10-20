import { ChevronDown, Search, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition';

export interface SearchableMultiSelectOption {
  id: string;
  label: string;
  description?: string;
}

interface SearchableMultiSelectProps {
  label: string;
  options: SearchableMultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}

const controlClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-left text-sm text-slate-800 shadow-sm transition focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-within:ring-primary-900/40';

/** Lightweight accessible multi-select for cross-module references. */
export function SearchableMultiSelect({ label, options, value, onChange, placeholder = 'ค้นหาแล้วเลือกได้หลายรายการ', className = '', testId }: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const menuPosition = useFloatingMenuPosition(controlRef, open);
  const selected = value.map((id) => options.find((option) => option.id === id)).filter((option): option is SearchableMultiSelectOption => Boolean(option));
  const normalized = search.trim().toLocaleLowerCase('th');
  const filtered = options.filter((option) => !normalized || `${option.label} ${option.description ?? ''}`.toLocaleLowerCase('th').includes(normalized));

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  };

  useEffect(() => {
    if (open) menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setSearch('');
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => !open ? 0 : (current + direction + filtered.length) % Math.max(1, filtered.length));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) toggle(option.id);
    } else if (event.key === 'Backspace' && !search && value.length) {
      onChange(value.slice(0, -1));
    } else if (event.key === 'Tab') {
      setOpen(false);
      setSearch('');
    }
  };

  return (
    <div data-ui="picker" ref={rootRef} className={`relative ${className}`} data-testid={testId}>
      <label htmlFor={listId + '-input'} className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</label>
      <div
        ref={controlRef}
        className={controlClass}
        onClick={() => setOpen(true)}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((option) => (
            <span key={option.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-50 px-2 py-1 text-xs font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-200">
              <span className="max-w-[17rem] truncate">{option.label}</span>
              <button type="button" aria-label={`เอา ${option.label} ออก`} className="rounded-full p-0.5 hover:bg-primary-100 dark:hover:bg-primary-800" onClick={(event) => { event.stopPropagation(); toggle(option.id); }}>
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          <div className="flex min-w-[150px] flex-1 items-center gap-1">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              id={listId + '-input'}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-activedescendant={open && filtered[activeIndex] ? listId + '-option-' + activeIndex : undefined}
              value={search}
              onChange={(event) => { setSearch(event.target.value); setActiveIndex(0); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={selected.length ? 'ค้นหาเพิ่ม...' : placeholder}
              className="min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-slate-400"
              aria-label={label}
            />
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </div>
        </div>
      </div>
      {open && menuPosition && createPortal(
        <div ref={menuRef} id={listId} role="listbox" aria-multiselectable="true" aria-label={label} style={menuPosition} className="fixed z-modal-popover overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {filtered.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">ไม่พบรายการที่ค้นหา</p>}
          {filtered.map((option, index) => {
            const checked = value.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                id={listId + '-option-' + index}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                aria-selected={checked}
                className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-primary-50 dark:hover:bg-slate-800 ${checked || activeIndex === index ? 'bg-primary-50/70 dark:bg-primary-900/30' : ''}`}
                onClick={() => toggle(option.id)}
              >
                <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>{checked ? '✓' : ''}</span>
                <span className="min-w-0"><span className="block whitespace-normal font-medium">{option.label}</span>{option.description && <span className="block whitespace-normal text-xs text-slate-500">{option.description}</span>}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
      <p className="mt-2 text-xs text-slate-500">เลือกแล้ว {selected.length} รายการ · ใช้ปุ่มลูกศรและ Enter เพื่อเลือก</p>
    </div>
  );
}
