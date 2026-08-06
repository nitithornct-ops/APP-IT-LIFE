import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNavItems } from '../../hooks/useNavItems';
import type { NavItem } from '../../config/navigation';
import { cn } from '../../utils/cn';

/** ค้นหาเมนูด่วน (Ctrl+K / Cmd+K) — สืบทอดแนวคิดจาก .cmdk-overlay ของระบบเดิม */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const groups = useNavItems();

  const results = useMemo<NavItem[]>(() => {
    const all = groups.flatMap((g) => g.items);
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter((item) => item.label.toLowerCase().includes(q));
  }, [groups, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function goTo(item: NavItem | undefined) {
    if (!item) return;
    navigate(item.path);
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      goTo(results[activeIndex]);
    } else if (event.key === 'Escape') {
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/45 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ค้นหาเมนู"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-elevated dark:bg-slate-800"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          <Search className="h-5 w-5 text-primary-600" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="พิมพ์ชื่อเมนูที่ต้องการไป..."
            className="flex-1 border-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">ไม่พบเมนูที่ตรงกับคำค้นหา</p>}
          {results.map((item, index) => (
            <button
              key={item.path}
              type="button"
              onClick={() => goTo(item)}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm',
                index === activeIndex ? 'bg-primary-50 text-primary-800 dark:bg-slate-700 dark:text-white' : 'text-slate-700 dark:text-slate-200',
              )}
            >
              <item.icon className="h-[18px] w-[18px] text-primary-600 dark:text-primary-300" aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex gap-4 border-t border-slate-100 px-4 py-2 text-xs text-slate-400 dark:border-slate-700">
          <span>
            <kbd className="rounded border border-slate-300 px-1.5 py-0.5 dark:border-slate-600">↑↓</kbd> เลือก
          </span>
          <span>
            <kbd className="rounded border border-slate-300 px-1.5 py-0.5 dark:border-slate-600">Enter</kbd> ไป
          </span>
          <span>
            <kbd className="rounded border border-slate-300 px-1.5 py-0.5 dark:border-slate-600">Esc</kbd> ปิด
          </span>
        </div>
      </div>
    </div>
  );
}
