import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Inbox,
  Loader2,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TableHTMLAttributes,
} from 'react';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';

interface DataTableProps extends TableHTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
  /** ปิดเมื่อหน้าจัดการ pagination จาก API ภายนอก component */
  pagination?: boolean;
  /** แสดงแถบค้นหา กรอง เลือกคอลัมน์ และส่งออกข้อมูล */
  toolbar?: boolean;
  initialPageSize?: number;
  itemLabel?: string;
  exportFileName?: string;
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(' ');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

function rowCells(row: ReactNode): ReactNode[] {
  if (!isValidElement<{ children?: ReactNode }>(row)) return [];
  return Children.toArray(row.props.children);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function saveCsv(headers: string[], rows: ReactNode[], visibleColumns: number[], fileName: string) {
  const lines = [
    visibleColumns.map((index) => csvCell(headers[index] || `คอลัมน์ ${index + 1}`)).join(','),
    ...rows.map((row) => {
      const cells = rowCells(row);
      return visibleColumns.map((index) => csvCell(nodeText(cells[index]).replace(/\s+/g, ' ').trim())).join(',');
    }),
  ];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function withVisibleColumns(node: ReactNode, hiddenColumns: Set<number>): ReactNode {
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  const cells = Children.toArray(node.props.children);
  if (!cells.length) return node;
  const isTableRow = cells.some((cell) => isValidElement(cell) && (cell.type === 'td' || cell.type === 'th'));
  if (!isTableRow) {
    return cloneElement(node, {}, cells.map((child) => withVisibleColumns(child, hiddenColumns)));
  }
  return cloneElement(
    node,
    {},
    cells.map((cell, index) => {
      if (!isValidElement<{ style?: CSSProperties }>(cell) || !hiddenColumns.has(index)) return cell;
      return cloneElement(cell, { style: { ...cell.props.style, display: 'none' } });
    }),
  );
}

/**
 * ตารางกลางของระบบ ทุก module ใช้ component นี้เพื่อให้ search, filter,
 * export, column visibility, pagination, responsive layout และ dark mode
 * เป็นมาตรฐานเดียวกันโดยอัตโนมัติ
 */
export function DataTable({
  className,
  containerClassName,
  children,
  pagination = true,
  toolbar = true,
  initialPageSize = 10,
  itemLabel = 'รายการ',
  exportFileName = `export-${new Date().toISOString().slice(0, 10)}.csv`,
  ...props
}: DataTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [search, setSearch] = useState('');
  const [filterColumn, setFilterColumn] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [hiddenColumnIndexes, setHiddenColumnIndexes] = useState<number[]>([]);
  const [showColumns, setShowColumns] = useState(false);
  const childArray = Children.toArray(children);
  const headIndex = childArray.findIndex((child) => isValidElement(child) && child.type === 'thead');
  const bodyIndex = childArray.findIndex((child) => isValidElement(child) && child.type === 'tbody');
  const head = headIndex >= 0 ? childArray[headIndex] as ReactElement<{ children?: ReactNode }> : null;
  const body = bodyIndex >= 0 ? childArray[bodyIndex] as ReactElement<{ children?: ReactNode }> : null;
  const rows = useMemo(() => body ? Children.toArray(body.props.children) : [], [body]);
  const headerRow = head ? Children.toArray(head.props.children).find((child) => isValidElement(child)) : null;
  const headers = rowCells(headerRow).map((cell, index) => nodeText(cell).replace(/\s+/g, ' ').trim() || `คอลัมน์ ${index + 1}`);
  const hiddenColumns = new Set(hiddenColumnIndexes);
  const visibleColumns = headers.map((_, index) => index).filter((index) => !hiddenColumns.has(index));
  const normalizedSearch = search.trim().toLocaleLowerCase('th-TH');
  const normalizedFilter = filterValue.trim().toLocaleLowerCase('th-TH');
  const filteredRows = rows.filter((row) => {
    const cells = rowCells(row).map((cell) => nodeText(cell).replace(/\s+/g, ' ').trim().toLocaleLowerCase('th-TH'));
    if (normalizedSearch && !cells.some((cell) => cell.includes(normalizedSearch))) return false;
    if (filterColumn !== '' && normalizedFilter && !cells[Number(filterColumn)]?.includes(normalizedFilter)) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows = pagination
    ? filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)
    : filteredRows;
  const renderedChildren = childArray.map((child, index) => {
    if (index === headIndex && head) {
      return cloneElement(head, {}, Children.map(head.props.children, (row) => withVisibleColumns(row, hiddenColumns)));
    }
    if (index === bodyIndex && body) {
      return cloneElement(body, {}, visibleRows.map((row) => withVisibleColumns(row, hiddenColumns)));
    }
    return child;
  });
  const hasActiveControls = Boolean(search || filterValue || hiddenColumnIndexes.length);

  useEffect(() => {
    setPage(1);
  }, [search, filterColumn, filterValue, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const resetControls = () => {
    setSearch('');
    setFilterColumn('');
    setFilterValue('');
    setHiddenColumnIndexes([]);
    setPage(1);
  };

  return (
    <div
      className={cn(
        'w-full rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
        containerClassName,
      )}
    >
      {toolbar && rows.length > 0 && (
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/60 p-3 lg:flex-row lg:items-center lg:justify-between dark:border-slate-700 dark:bg-slate-900/30">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block min-w-0 flex-1 sm:max-w-xs">
              <span className="sr-only">ค้นหาในตาราง</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ค้นหาในรายการ..."
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/40"
              />
            </label>
            {headers.length > 0 && (
              <div className="flex min-w-0 flex-1 gap-2 sm:max-w-md">
                <label className="relative min-w-32">
                  <span className="sr-only">เลือกคอลัมน์สำหรับกรอง</span>
                  <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <select
                    aria-label="เลือกคอลัมน์สำหรับกรอง"
                    value={filterColumn}
                    onChange={(event) => { setFilterColumn(event.target.value); setFilterValue(''); }}
                    className="h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-9 pr-7 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="">กรองข้อมูล</option>
                    {headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                </label>
                {filterColumn !== '' && (
                  <input
                    aria-label={`ค่าที่ต้องการกรองใน ${headers[Number(filterColumn)]}`}
                    value={filterValue}
                    onChange={(event) => setFilterValue(event.target.value)}
                    placeholder={`กรอง ${headers[Number(filterColumn)]}...`}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasActiveControls && (
              <Button type="button" variant="ghost" size="sm" onClick={resetControls}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />ล้างตัวกรอง
              </Button>
            )}
            {headers.length > 0 && (
              <div className="relative">
                <Button type="button" variant="outline" size="sm" aria-expanded={showColumns} onClick={() => setShowColumns((value) => !value)}>
                  <Columns3 className="h-4 w-4" aria-hidden="true" />คอลัมน์<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                {showColumns && (
                  <div className="absolute right-0 z-30 mt-2 max-h-72 min-w-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                    {headers.map((header, index) => {
                      const visible = !hiddenColumns.has(index);
                      const isLastVisible = visible && visibleColumns.length === 1;
                      return (
                        <button
                          key={`${header}-${index}`}
                          type="button"
                          disabled={isLastVisible}
                          onClick={() => setHiddenColumnIndexes((current) => visible ? [...current, index] : current.filter((item) => item !== index))}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <span className={cn('grid h-4 w-4 place-items-center rounded border', visible ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 dark:border-slate-600')}>
                            {visible && <Check className="h-3 w-3" aria-hidden="true" />}
                          </span>
                          {header}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <Button type="button" variant="outline" size="sm" disabled={filteredRows.length === 0} onClick={() => saveCsv(headers, filteredRows, visibleColumns, exportFileName)}>
              <Download className="h-4 w-4" aria-hidden="true" />ส่งออก CSV
            </Button>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {filteredRows.length.toLocaleString('th-TH')} {itemLabel}
            </span>
          </div>
        </div>
      )}
      <div className="w-full overflow-x-auto">
        <table
          className={cn(
            'w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm',
            '[&_thead]:bg-slate-50/90 [&_thead]:text-xs [&_thead]:font-semibold [&_thead]:text-slate-600 dark:[&_thead]:bg-slate-900/60 dark:[&_thead]:text-slate-300',
            '[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-slate-200 [&_th]:px-4 [&_th]:py-3 dark:[&_th]:border-slate-700',
            '[&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-primary-50/50 dark:[&_tbody_tr:hover]:bg-slate-700/40',
            '[&_td]:border-b [&_td]:border-slate-100 [&_td]:px-4 [&_td]:py-3 [&_tbody_tr:last-child_td]:border-b-0 dark:[&_td]:border-slate-700/80',
            className,
          )}
          {...props}
        >
          {renderedChildren}
        </table>
      </div>
      {filteredRows.length === 0 && rows.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700">
          ไม่พบข้อมูลที่ตรงกับคำค้นหาหรือตัวกรอง
        </div>
      )}
      {pagination && filteredRows.length > 0 && (
        <div className="px-4 pb-4">
          <TablePagination page={safePage} pageSize={pageSize} totalItems={filteredRows.length} totalPages={totalPages} itemLabel={itemLabel} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}
    </div>
  );
}

interface TableToolbarProps extends HTMLAttributes<HTMLDivElement> {
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  filters?: ReactNode;
  actions?: ReactNode;
}

/** Toolbar สำหรับหน้าที่ใช้ server-side search/filter */
export function TableToolbar({ searchValue, searchPlaceholder = 'ค้นหา...', onSearchChange, filters, actions, className, children, ...props }: TableToolbarProps) {
  return (
    <div className={cn('mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center', className)} {...props}>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        {onSearchChange && (
          <label className="relative block w-full max-w-sm">
            <span className="sr-only">ค้นหา</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" value={searchValue ?? ''} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/40" />
          </label>
        )}
        {filters}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

interface TablePaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
}

export function TablePagination({ page, pageSize, totalItems, totalPages: suppliedTotalPages, onPageChange, onPageSizeChange, pageSizeOptions = [10, 25, 50, 100], itemLabel = 'รายการ' }: TablePaginationProps) {
  const pageSizeId = useId();
  const totalPages = Math.max(1, suppliedTotalPages ?? Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalItems);
  return (
    <nav className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm sm:flex-row dark:border-slate-700" aria-label="การแบ่งหน้าตาราง">
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <label htmlFor={pageSizeId}>แสดงต่อหน้า</label>
        <select id={pageSizeId} aria-label="จำนวนรายการต่อหน้า" value={pageSize} disabled={!onPageSizeChange} onChange={(event) => onPageSizeChange?.(Number(event.target.value))} className="h-9 rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-700 disabled:cursor-default disabled:opacity-80 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
          {(pageSizeOptions.includes(pageSize) ? pageSizeOptions : [...pageSizeOptions, pageSize].sort((a, b) => a - b)).map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <span>{itemLabel} {start.toLocaleString('th-TH')}–{end.toLocaleString('th-TH')} จาก {totalItems.toLocaleString('th-TH')}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" aria-label="หน้าก่อนหน้า" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} className="h-9 min-h-9 w-9 px-0"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
        <span className="min-w-24 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">หน้า {safePage.toLocaleString('th-TH')} / {totalPages.toLocaleString('th-TH')}</span>
        <Button type="button" variant="outline" size="sm" aria-label="หน้าถัดไป" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)} className="h-9 min-h-9 w-9 px-0"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
    </nav>
  );
}

export function TableLoading({ columns = 6, rows = 7 }: { columns?: number; rows?: number }) {
  return <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700" role="status" aria-label="กำลังโหลดข้อมูล"><div className="grid h-11 grid-cols-6 gap-4 bg-slate-50 px-4 dark:bg-slate-900/60">{Array.from({ length: Math.min(columns, 6) }, (_, index) => <div key={index} className="my-auto h-3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />)}</div>{Array.from({ length: rows }, (_, row) => <div key={row} className="grid h-14 grid-cols-6 gap-4 border-t border-slate-100 px-4 dark:border-slate-700">{Array.from({ length: Math.min(columns, 6) }, (_, column) => <div key={column} className="my-auto h-3 animate-pulse rounded bg-slate-100 dark:bg-slate-700/70" />)}</div>)}<span className="sr-only">กำลังโหลดข้อมูล...</span></div>;
}

export function TableEmpty({ title = 'ยังไม่มีข้อมูล', description = 'ยังไม่มีรายการในระบบ', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/20"><Inbox className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" aria-hidden="true" /><p className="font-bold text-slate-700 dark:text-slate-200">{title}</p><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

export function TableError({ message = 'ไม่สามารถโหลดข้อมูลได้', onRetry }: { message?: string; onRetry?: () => void }) {
  return <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50/60 px-6 py-10 text-center dark:border-red-900/60 dark:bg-red-950/20" role="alert"><p className="font-bold text-red-700 dark:text-red-300">{message}</p><p className="mt-1 text-sm text-red-600/80 dark:text-red-300/80">กรุณาลองใหม่อีกครั้ง</p>{onRetry && <Button className="mt-4" type="button" size="sm" variant="outline" onClick={onRetry}><RotateCcw className="h-4 w-4" aria-hidden="true" />ลองใหม่</Button>}</div>;
}

export function TableLoadingInline({ label = 'กำลังโหลดข้อมูล...' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{label}</div>;
}
