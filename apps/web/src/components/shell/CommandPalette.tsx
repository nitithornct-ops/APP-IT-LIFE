import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useNavItems } from '../../hooks/useNavItems';
import type { NavItem } from '../../config/navigation';
import { apiFetch } from '../../services/apiClient';
import { cn } from '../../utils/cn';

/** ค้นหาด่วน (Ctrl+K / Cmd+K) — สืบทอดแนวคิดจาก .cmdk-overlay ของระบบเดิม */

interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  path: string;
}

interface SearchResultGroup {
  module: string;
  label: string;
  items: SearchResultItem[];
}

interface CmdbSearchResult {
  items: Array<{
    id: string;
    ci_code: string;
    name: string;
    ci_type: string;
    environment: string;
    status: string;
  }>;
}

/** หนึ่งบรรทัดที่กดได้ ไม่ว่าจะมาจากเมนูหรือจากข้อมูลจริง — ปุ่มลูกศรเลื่อนข้ามกลุ่มได้เป็นเส้นเดียว */
interface PaletteRow {
  key: string;
  label: string;
  hint?: string;
  path: string;
  icon?: NavItem['icon'];
}

/** ต้องตรงกับ searchQuerySchema ฝั่ง api — ต่ำกว่านี้ยิงไปก็ถูกปฏิเสธกลับมาเปล่า ๆ */
const MIN_QUERY_LENGTH = 2;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const groups = useNavItems();
  const canSearchCmdb = groups.some((group) => group.items.some((item) => item.path === '/cmdb'));

  const trimmed = query.trim();
  // หน่วงก่อนยิง เพราะทุกตัวอักษรที่พิมพ์คือการค้นข้ามหลายตารางพร้อมกัน
  const debouncedQuery = useDebouncedValue(trimmed, 250);
  const canSearchRecords = debouncedQuery.length >= MIN_QUERY_LENGTH;

  const recordsQuery = useQuery({
    queryKey: ['global-search', debouncedQuery],
    queryFn: () => apiFetch<{ groups: SearchResultGroup[] }>(`/api/v1/search?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: open && canSearchRecords,
    staleTime: 30_000,
  });

  // ใช้ list endpoint เดิมของ CMDB เพื่อเติมผล CI โดยไม่ขยาย API contract และยิงเฉพาะผู้ใช้ที่เห็นเมนู CMDB
  const cmdbQuery = useQuery({
    queryKey: ['global-search', 'cmdb', debouncedQuery],
    queryFn: () => apiFetch<CmdbSearchResult>(`/api/v1/cmdb/items?page=1&pageSize=5&search=${encodeURIComponent(debouncedQuery)}`),
    enabled: open && canSearchRecords && canSearchCmdb,
    staleTime: 30_000,
  });

  const menuSections = useMemo(() => {
    const needle = trimmed.toLowerCase();
    return groups.map((group) => ({
      label: group.title,
      rows: group.items
        .filter((item) => !needle || item.label.toLowerCase().includes(needle))
        .map((item) => ({ key: `menu:${item.path}`, label: item.label, path: item.path, icon: item.icon })),
    })).filter((section) => section.rows.length > 0);
  }, [groups, trimmed]);


  // เมนูมาก่อนเสมอ เพราะตอบสนองทันทีจากข้อมูลในเครื่อง ส่วนผลจากฐานข้อมูลมาทีหลัง
  // ถ้าสลับกัน รายการที่ผู้ใช้เล็งไว้จะขยับหนีตอนผลค้นหามาถึง แล้วกด Enter โดนผิดอัน
  const sections = useMemo(() => {
    const list: { label: string; rows: PaletteRow[] }[] = [...menuSections];
    for (const group of recordsQuery.data?.groups ?? []) {
      list.push({
        label: group.label,
        rows: group.items.map((item) => ({
          key: `${group.module}:${item.id}`,
          label: item.title,
          hint: item.subtitle,
          path: item.path,
        })),
      });
    }
    const configurationItems = cmdbQuery.data?.items ?? [];
    if (configurationItems.length > 0) {
      list.push({
        label: 'Configuration Item (CI)',
        rows: configurationItems.map((item) => ({
          key: `ci:${item.id}`,
          label: `${item.ci_code} · ${item.name}`,
          hint: [item.ci_type, item.environment, item.status].filter(Boolean).join(' · '),
          path: `/cmdb/${item.id}`,
        })),
      });
    }
    return list;
  }, [cmdbQuery.data, menuSections, recordsQuery.data]);

  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);

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

  function goTo(row: PaletteRow | undefined) {
    if (!row) return;
    navigate(row.path);
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      goTo(rows[activeIndex]);
    } else if (event.key === 'Escape') {
      onClose();
    }
  }

  if (!open) return null;

  let rowOffset = 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/45 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ค้นหาด่วน"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-modal border border-slate-200 bg-white shadow-elevated dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          <Search className="h-5 w-5 text-primary-600" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ค้นหาเมนู เลขที่ใบงาน รหัสทรัพย์สิน..."
            aria-label="คำค้นหา"
            className="flex-1 border-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          {(recordsQuery.isFetching || cmdbQuery.isFetching) && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />}
        </div>

        <div className="max-h-[58vh] overflow-y-auto p-2">
          {rows.length === 0 && !recordsQuery.isFetching && !cmdbQuery.isFetching && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              {trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH
                ? `พิมพ์อย่างน้อย ${MIN_QUERY_LENGTH} ตัวอักษรเพื่อค้นหาข้อมูล`
                : 'ไม่พบสิ่งที่ตรงกับคำค้นหา'}
            </p>
          )}

          {menuSections.length > 0 && (
            <p className="px-3 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">เมนู</p>
          )}

          {sections.map((section) => {
            const offset = rowOffset;
            rowOffset += section.rows.length;
            return (
              <div key={section.label} className="mb-1.5">
                <p className="flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary-600 dark:text-primary-300"><span className="h-1.5 w-1.5 rounded-full bg-primary-500" />{section.label}</p>
                {section.rows.map((row, index) => {
                  const position = offset + index;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => goTo(row)}
                      onMouseEnter={() => setActiveIndex(position)}
                      className={cn(
                        'flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                        position === activeIndex ? 'bg-primary-50 text-primary-800 dark:bg-slate-700 dark:text-white' : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      {row.icon && <row.icon className="h-[18px] w-[18px] shrink-0 text-primary-600 dark:text-primary-300" aria-hidden="true" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{row.label}</span>
                        {row.hint && <span className="block truncate text-xs text-slate-400">{row.hint}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
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
