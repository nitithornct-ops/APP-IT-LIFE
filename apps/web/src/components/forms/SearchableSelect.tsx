import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface SearchableSelectOption {
  id: string;
  label: string;
  description?: string;
}

interface SearchableSelectProps {
  label: string;
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}

const controlClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-left text-sm text-slate-800 shadow-sm transition focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-within:ring-primary-900/40';

/** Single-value searchable picker for governed foreign-key references. */
export function SearchableSelect({ label, options, value, onChange, required, placeholder = 'พิมพ์ค้นหาเพื่อเลือก', disabled, testId }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.id === value);
  const normalized = search.trim().toLocaleLowerCase('th');
  const filtered = options.filter((option) => !normalized || `${option.label} ${option.description ?? ''}`.toLocaleLowerCase('th').includes(normalized));

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const pick = (id: string) => {
    onChange(id);
    setSearch('');
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setSearch('');
    } else if (event.key === 'Enter' && filtered[0]) {
      event.preventDefault();
      pick(filtered[0].id);
    }
  };

  return (
    <div ref={rootRef} className="relative" data-testid={testId}>
      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">{label}{required && <span className="ml-1 text-red-600">*</span>}</span>
      <div role="combobox" aria-expanded={open} aria-controls={listId} aria-haspopup="listbox" className={`${controlClass} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`} onClick={() => !disabled && setOpen(true)}>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={open ? search : selected?.label ?? ''}
            onChange={(event) => { setSearch(event.target.value); setOpen(true); }}
            onFocus={() => !disabled && setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={selected ? selected.label : placeholder}
            required={required && !value}
            disabled={disabled}
            aria-label={label}
            className="min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-slate-400"
          />
          {value && <button type="button" aria-label={`ล้าง ${label}`} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={(event) => { event.stopPropagation(); onChange(''); setSearch(''); }}><X className="h-4 w-4" aria-hidden="true" /></button>}
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </div>
      </div>
      {open && !disabled && (
        <div id={listId} role="listbox" aria-label={label} className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {filtered.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">ไม่พบรายการที่ค้นหา</p>}
          {filtered.map((option) => (
            <button key={option.id} type="button" role="option" aria-selected={option.id === value} className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-primary-50 dark:hover:bg-slate-800 ${option.id === value ? 'bg-primary-50/70 dark:bg-primary-900/30' : ''}`} onClick={() => pick(option.id)}>
              <span className="mt-0.5 h-4 w-4 shrink-0">{option.id === value && <Check className="h-4 w-4 text-primary-600" aria-hidden="true" />}</span>
              <span className="min-w-0"><span className="block truncate font-medium">{option.label}</span>{option.description && <span className="block truncate text-xs text-slate-500">{option.description}</span>}</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-[11px] text-slate-400">ค้นหาและเลือกจากทะเบียนกลาง ไม่ต้องกรอก UUID</p>
    </div>
  );
}
