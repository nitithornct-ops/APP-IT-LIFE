import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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
import { downloadCsv } from '../../utils/csv';

/**
 * client = ตารางถือข้อมูลครบชุด จึงค้นหา/กรอง/แบ่งหน้า/ส่งออกในตัวได้
 * server = หน้าเป็นคนจัดการ search/filter/pagination เอง (ยิง API หรือ slice เอง)
 *          ตารางจะ render เฉพาะแถวที่ได้รับมา และไม่สร้าง toolbar/pagination ซ้อน
 *          — สำคัญเพราะ toolbar ในตัวจะค้นได้แค่แถวของหน้าปัจจุบัน ทำให้ผลลัพธ์ผิด
 */
export type DataTableMode = 'client' | 'server';

export interface TableSort {
  /** ค่าเดียวกับ data-sort-key บน <th> — ใน server mode คือชื่อคอลัมน์ที่ส่งไปกับ query */
  key: string;
  order: 'asc' | 'desc';
}

interface DataTableProps extends TableHTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
  /**
   * สถานะการเรียงปัจจุบัน ส่งมาคู่กับ onSortChange เพื่อให้หน้าเป็นเจ้าของ state
   * ถ้าไม่ส่งทั้งคู่ ตารางจะจำสถานะเองและเรียงข้อมูลในตัว (ใช้ได้เฉพาะ mode="client")
   */
  sort?: TableSort | null;
  /** เรียกเมื่อผู้ใช้กดหัวคอลัมน์ที่มี data-sort-key — null คือกลับไปใช้ลำดับเริ่มต้น */
  onSortChange?: (sort: TableSort | null) => void;
  /**
   * แหล่งที่จัดการ search/filter/sort/pagination
   * ค่าเริ่มต้น 'client' เพื่อให้หน้าเดิมทั้งหมดทำงานเหมือนเดิม
   */
  mode?: DataTableMode;
  /** ปิดเมื่อหน้าจัดการ pagination จาก API ภายนอก component */
  pagination?: boolean;
  /** แสดงแถบค้นหา กรอง เลือกคอลัมน์ และส่งออกข้อมูล */
  toolbar?: boolean;
  initialPageSize?: number;
  itemLabel?: string;
  exportFileName?: string;
  /**
   * ตรึงหัวตารางไว้ขณะเลื่อนดูแถว
   * ต้องให้ตารางมี scroll ของตัวเอง (maxBodyHeight) เพราะ position: sticky อ้างอิงกล่องที่เลื่อน
   * ไม่ใช่หน้าเว็บ — เปิดกับตารางที่แถวเยอะจริงเท่านั้น ไม่งั้นจะได้ scrollbar ซ้อนโดยไม่จำเป็น
   */
  stickyHeader?: boolean;
  /** ความสูงสูงสุดของตารางเมื่อเปิด stickyHeader */
  maxBodyHeight?: string;
  /** ตรึงคอลัมน์แรกไว้ขณะเลื่อนแนวนอน — ใช้กับตารางกว้างที่คอลัมน์แรกคือตัวระบุแถว */
  freezeFirstColumn?: boolean;
  /**
   * บนจอแคบให้เรียงเป็นการ์ดแทนการเลื่อนแนวนอน
   * ต้องใส่ data-label ให้ <td> ทุกช่องก่อน ไม่งั้นการ์ดจะไม่มีชื่อฟิลด์กำกับ
   */
  cardOnMobile?: boolean;
  /** จำคอลัมน์ที่ซ่อนและจำนวนแถวต่อหน้าไว้ใน localStorage ด้วยคีย์นี้ */
  tableId?: string;
  /** เพิ่มคอลัมน์ช่องเลือก — <tr> ต้องมี data-row-id เพื่อบอกว่าแถวนั้นคือรายการไหน */
  selectable?: boolean;
  /** รายการที่เลือกอยู่ ส่งมาคู่กับ onSelectionChange เพื่อให้หน้าเป็นเจ้าของ state */
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** ปุ่มที่จะโผล่บนแถบ "เลือก N รายการ" */
  selectionActions?: ReactNode;
}

interface StoredTablePrefs {
  /** เก็บเป็นชื่อหัวคอลัมน์ ไม่ใช่ตำแหน่ง เพราะลำดับคอลัมน์เปลี่ยนได้ระหว่าง deploy */
  hidden?: string[];
  pageSize?: number;
}

function prefsStorageKey(tableId: string): string {
  return `itlife-table:${tableId}`;
}

function readTablePrefs(tableId: string | undefined): StoredTablePrefs {
  if (!tableId) return {};
  try {
    const raw = localStorage.getItem(prefsStorageKey(tableId));
    const parsed = raw ? JSON.parse(raw) as StoredTablePrefs : {};
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((item) => typeof item === 'string') : undefined,
      pageSize: Number.isInteger(parsed.pageSize) && (parsed.pageSize ?? 0) > 0 ? parsed.pageSize : undefined,
    };
  } catch {
    // localStorage ปิดอยู่หรือค่าที่เก็บไว้เสีย — ใช้ค่าเริ่มต้นแทนการพังทั้งตาราง
    return {};
  }
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

function saveCsv(headers: string[], rows: ReactNode[], visibleColumns: number[], fileName: string) {
  downloadCsv(
    [
      visibleColumns.map((index) => headers[index] || `คอลัมน์ ${index + 1}`),
      ...rows.map((row) => {
        const cells = rowCells(row);
        return visibleColumns.map((index) => nodeText(cells[index]).replace(/\s+/g, ' ').trim());
      }),
    ],
    fileName,
  );
}

type CellProps = {
  children?: ReactNode;
  'data-sort-key'?: string;
  'data-sort-label'?: string;
  'data-sort-value'?: string | number;
};

/** อ่านชื่อคอลัมน์สำหรับเรียงจาก <th data-sort-key="..."> เรียงตามตำแหน่งคอลัมน์ */
function headerSortKeys(headerRow: ReactNode): (string | undefined)[] {
  return rowCells(headerRow).map((cell) => (isValidElement<CellProps>(cell) ? cell.props['data-sort-key'] : undefined));
}

/**
 * ค่าที่ใช้เปรียบเทียบของหนึ่งเซลล์ — ถ้า <td> ระบุ data-sort-value มาจะใช้ค่านั้น
 * เพราะข้อความที่แสดง (วันที่ไทย, Badge, จำนวนที่มีคอมมา) เรียงตามตัวอักษรแล้วได้ลำดับผิด
 */
function cellSortValue(cell: ReactNode): string {
  if (isValidElement<CellProps>(cell)) {
    const explicit = cell.props['data-sort-value'];
    if (explicit !== undefined && explicit !== null) return String(explicit);
  }
  return nodeText(cell).replace(/\s+/g, ' ').trim();
}

function compareSortValues(a: string, b: string): number {
  const numberA = Number(a);
  const numberB = Number(b);
  if (!Number.isNaN(numberA) && !Number.isNaN(numberB)) return numberA - numberB;
  return a.localeCompare(b, 'th-TH');
}

/** เรียงแถวในตัว (client mode) โดยดันแถวที่ไม่มีค่าไปท้ายเสมอ เหมือน nullsFirst: false ของฝั่ง api */
function sortRows(rows: ReactNode[], columnIndex: number, order: 'asc' | 'desc'): ReactNode[] {
  const direction = order === 'desc' ? -1 : 1;
  return [...rows].sort((rowA, rowB) => {
    const valueA = cellSortValue(rowCells(rowA)[columnIndex]);
    const valueB = cellSortValue(rowCells(rowB)[columnIndex]);
    if (valueA === valueB) return 0;
    if (valueA === '') return 1;
    if (valueB === '') return -1;
    return direction * compareSortValues(valueA, valueB);
  });
}

/** เปลี่ยน <th data-sort-key> ให้เป็นปุ่มกดเรียง พร้อม aria-sort ให้ screen reader */
function withSortableHeaders(
  row: ReactNode,
  activeSort: TableSort | null,
  onSort: (key: string) => void,
): ReactNode {
  if (!isValidElement<{ children?: ReactNode }>(row)) return row;
  const cells = Children.toArray(row.props.children);
  if (!cells.some((cell) => isValidElement(cell) && cell.type === 'th')) return row;
  return cloneElement(
    row,
    {},
    cells.map((cell) => {
      if (!isValidElement<CellProps>(cell) || cell.type !== 'th') return cell;
      const key = cell.props['data-sort-key'];
      if (!key) return cell;
      const active = activeSort?.key === key;
      const Icon = active ? (activeSort.order === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
      return cloneElement(
        cell,
        { 'aria-sort': active ? (activeSort.order === 'asc' ? 'ascending' : 'descending') : 'none' } as Record<string, string>,
        <button
          type="button"
          onClick={() => onSort(key)}
          className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-left font-semibold hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 dark:hover:text-primary-300"
        >
          {cell.props.children}
          {/*
            คำขยายเมื่อหัวคอลัมน์รวมหลายอย่างไว้ด้วยกัน (เช่น "สถานะ/SLA")
            ต่อท้ายชื่อคอลัมน์ ไม่ใช้ aria-label ทับ — aria-label จะแทนที่ชื่อของปุ่ม
            และชื่อของ <th> ก็คำนวณจากเนื้อหาข้างใน ทำให้หัวคอลัมน์หายชื่อตัวเองไปจาก screen reader
          */}
          {cell.props['data-sort-label'] && <span className="sr-only"> ({cell.props['data-sort-label']})</span>}
          <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-primary-600 dark:text-primary-300' : 'text-slate-400')} aria-hidden="true" />
        </button>,
      );
    }),
  );
}

const SELECT_CELL_CLASS = 'w-10 px-3 py-3 align-middle';

function rowId(row: ReactNode): string | null {
  if (!isValidElement<{ 'data-row-id'?: string }>(row)) return null;
  return row.props['data-row-id'] ?? null;
}

/** เก็บ id ของทุกแถวที่เลือกได้ในชุดที่กำลังแสดงอยู่ (ข้ามแถวขยาย/แถวสรุปที่ไม่มี data-row-id) */
function selectableRowIds(rows: ReactNode[]): string[] {
  return rows.map(rowId).filter((id): id is string => Boolean(id));
}

/** เติมช่องเลือกไว้หน้าแถว — ทำเป็นขั้นตอนสุดท้ายเสมอ เพราะการซ่อนคอลัมน์อ้างอิงตำแหน่งเดิม */
function withSelectionCell(row: ReactNode, cell: ReactNode): ReactNode {
  if (!isValidElement<{ children?: ReactNode }>(row)) return row;
  return cloneElement(row, {}, [cell, ...Children.toArray(row.props.children)]);
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
  mode = 'client',
  sort: controlledSort,
  onSortChange,
  pagination = true,
  toolbar = true,
  initialPageSize = 10,
  itemLabel = 'รายการ',
  exportFileName = `export-${new Date().toISOString().slice(0, 10)}.csv`,
  stickyHeader = false,
  maxBodyHeight = '70vh',
  freezeFirstColumn = false,
  cardOnMobile = false,
  tableId,
  selectable = false,
  selectedIds,
  onSelectionChange,
  selectionActions,
  ...props
}: DataTableProps) {
  const [storedPrefs] = useState(() => readTablePrefs(tableId));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(storedPrefs.pageSize ?? initialPageSize);
  const [search, setSearch] = useState('');
  const [filterColumn, setFilterColumn] = useState('');
  const [filterValue, setFilterValue] = useState('');
  // เก็บเป็นชื่อหัวคอลัมน์ ไม่ใช่ index เพื่อให้ค่าที่จำไว้ยังชี้คอลัมน์เดิมแม้ลำดับจะเปลี่ยน
  const [hiddenColumnNames, setHiddenColumnNames] = useState<string[]>(storedPrefs.hidden ?? []);
  const [showColumns, setShowColumns] = useState(false);
  const [internalSort, setInternalSort] = useState<TableSort | null>(null);
  const [internalSelection, setInternalSelection] = useState<string[]>([]);
  const isServerMode = mode === 'server';
  const selection = onSelectionChange ? selectedIds ?? [] : internalSelection;
  const setSelection = (ids: string[]) => {
    if (onSelectionChange) onSelectionChange(ids);
    else setInternalSelection(ids);
  };
  // controlled เมื่อหน้าส่ง onSortChange มา ไม่งั้นตารางจำสถานะเอง
  const isSortControlled = Boolean(onSortChange);
  const activeSort = isSortControlled ? controlledSort ?? null : internalSort;
  const childArray = Children.toArray(children);
  const headIndex = childArray.findIndex((child) => isValidElement(child) && child.type === 'thead');
  const bodyIndex = childArray.findIndex((child) => isValidElement(child) && child.type === 'tbody');
  const head = headIndex >= 0 ? childArray[headIndex] as ReactElement<{ children?: ReactNode }> : null;
  const body = bodyIndex >= 0 ? childArray[bodyIndex] as ReactElement<{ children?: ReactNode }> : null;
  const rows = useMemo(() => body ? Children.toArray(body.props.children) : [], [body]);
  const headerRow = head ? Children.toArray(head.props.children).find((child) => isValidElement(child)) : null;
  const headers = rowCells(headerRow).map((cell, index) => nodeText(cell).replace(/\s+/g, ' ').trim() || `คอลัมน์ ${index + 1}`);
  const hiddenColumns = new Set(headers.map((header, index) => (hiddenColumnNames.includes(header) ? index : -1)).filter((index) => index >= 0));
  const visibleColumns = headers.map((_, index) => index).filter((index) => !hiddenColumns.has(index));
  const normalizedSearch = search.trim().toLocaleLowerCase('th-TH');
  const normalizedFilter = filterValue.trim().toLocaleLowerCase('th-TH');
  // server mode: หน้าเป็นคนกรอง/แบ่งหน้าเองแล้ว ตารางแสดงแถวที่ได้รับมาตรง ๆ
  const matchedRows = isServerMode ? rows : rows.filter((row) => {
    const cells = rowCells(row).map((cell) => nodeText(cell).replace(/\s+/g, ' ').trim().toLocaleLowerCase('th-TH'));
    if (normalizedSearch && !cells.some((cell) => cell.includes(normalizedSearch))) return false;
    if (filterColumn !== '' && normalizedFilter && !cells[Number(filterColumn)]?.includes(normalizedFilter)) return false;
    return true;
  });
  // server mode เรียงมาจาก API แล้ว ตารางจึงเรียงเองเฉพาะตอนถือข้อมูลครบชุด
  const sortColumnIndex = activeSort ? headerSortKeys(headerRow).indexOf(activeSort.key) : -1;
  const filteredRows = !isServerMode && activeSort && sortColumnIndex >= 0
    ? sortRows(matchedRows, sortColumnIndex, activeSort.order)
    : matchedRows;
  const showToolbar = toolbar && !isServerMode && rows.length > 0;
  const showPagination = pagination && !isServerMode && filteredRows.length > 0;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows = pagination && !isServerMode
    ? filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)
    : filteredRows;
  /** asc → desc → กลับไปลำดับเริ่มต้น */
  const handleSort = (key: string) => {
    const next: TableSort | null = activeSort?.key !== key
      ? { key, order: 'asc' }
      : activeSort.order === 'asc' ? { key, order: 'desc' } : null;
    if (onSortChange) onSortChange(next);
    else setInternalSort(next);
  };

  // id ของแถวที่เลือกได้ "ในหน้านี้" — ใช้กับช่องเลือกทั้งหมดบนหัวตาราง
  const pageRowIds = selectable ? selectableRowIds(visibleRows) : [];
  const selectedOnPage = pageRowIds.filter((id) => selection.includes(id));
  const allOnPageSelected = pageRowIds.length > 0 && selectedOnPage.length === pageRowIds.length;

  const toggleRow = (id: string) => {
    setSelection(selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]);
  };
  // เลือก/ยกเลิกเฉพาะแถวในหน้านี้ ไม่ไปแตะรายการที่เลือกไว้จากหน้าอื่น
  const toggleAllOnPage = () => {
    setSelection(allOnPageSelected
      ? selection.filter((id) => !pageRowIds.includes(id))
      : [...selection, ...pageRowIds.filter((id) => !selection.includes(id))]);
  };

  const renderedChildren = childArray.map((child, index) => {
    if (index === headIndex && head) {
      let headRows = Children.map(head.props.children, (row) => withSortableHeaders(row, activeSort, handleSort));
      if (!isServerMode) headRows = Children.map(headRows, (row) => withVisibleColumns(row, hiddenColumns));
      if (selectable) {
        headRows = Children.map(headRows, (row) => withSelectionCell(
          row,
          <th key="select" scope="col" className={SELECT_CELL_CLASS}>
            <input
              type="checkbox"
              aria-label="เลือกทุกรายการในหน้านี้"
              className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-400 dark:border-slate-600"
              checked={allOnPageSelected}
              disabled={pageRowIds.length === 0}
              onChange={toggleAllOnPage}
            />
          </th>,
        ));
      }
      return cloneElement(head, {}, headRows);
    }
    if (index === bodyIndex && body) {
      if (isServerMode && !selectable) return child;
      let bodyRows = isServerMode ? visibleRows : visibleRows.map((row) => withVisibleColumns(row, hiddenColumns));
      if (selectable) {
        bodyRows = bodyRows.map((row, rowIndex) => {
          const id = rowId(visibleRows[rowIndex]);
          // แถวขยาย/แถวสรุปที่ไม่มี data-row-id ยังต้องได้ช่องว่าง ไม่งั้นคอลัมน์จะเหลื่อมกัน
          if (!id) return withSelectionCell(row, <td key="select" className={SELECT_CELL_CLASS} />);
          return withSelectionCell(
            row,
            <td key="select" className={SELECT_CELL_CLASS}>
              <input
                type="checkbox"
                aria-label={`เลือกรายการ ${id}`}
                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-400 dark:border-slate-600"
                checked={selection.includes(id)}
                onChange={() => toggleRow(id)}
              />
            </td>,
          );
        });
      }
      return cloneElement(body, {}, bodyRows);
    }
    return child;
  });
  const hasActiveControls = Boolean(search || filterValue || hiddenColumnNames.length || activeSort);

  useEffect(() => {
    setPage(1);
  }, [search, filterColumn, filterValue, pageSize, activeSort?.key, activeSort?.order]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!tableId) return;
    try {
      localStorage.setItem(prefsStorageKey(tableId), JSON.stringify({ hidden: hiddenColumnNames, pageSize }));
    } catch {
      // เขียนไม่ได้ (โหมดส่วนตัว/พื้นที่เต็ม) ก็แค่ไม่จำค่าไว้ ไม่ต้องรบกวนผู้ใช้
    }
  }, [tableId, hiddenColumnNames, pageSize]);

  const resetControls = () => {
    setSearch('');
    setFilterColumn('');
    setFilterValue('');
    setHiddenColumnNames([]);
    setInternalSort(null);
    if (onSortChange) onSortChange(null);
    setPage(1);
  };

  return (
    <div
      className={cn(
        'w-full rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
        containerClassName,
      )}
    >
      {showToolbar && (
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
                          onClick={() => setHiddenColumnNames((current) => visible ? [...current, header] : current.filter((item) => item !== header))}
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
      <div
        className={cn('w-full overflow-x-auto', stickyHeader && 'overflow-y-auto')}
        style={stickyHeader ? { maxHeight: maxBodyHeight } : undefined}
      >
        <table
          className={cn(
            'w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm',
            '[&_thead]:bg-slate-50/90 [&_thead]:text-xs [&_thead]:font-semibold [&_thead]:text-slate-600 dark:[&_thead]:bg-slate-900/60 dark:[&_thead]:text-slate-300',
            '[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-slate-200 [&_th]:px-4 [&_th]:py-3 dark:[&_th]:border-slate-700',
            '[&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-primary-50/50 dark:[&_tbody_tr:hover]:bg-slate-700/40',
            '[&_td]:border-b [&_td]:border-slate-100 [&_td]:px-4 [&_td]:py-3 [&_tbody_tr:last-child_td]:border-b-0 dark:[&_td]:border-slate-700/80',
            // thead โปร่งแสงอยู่ ถ้าตรึงไว้เฉย ๆ แถวจะเลื่อนทะลุขึ้นมาเห็นข้างหลัง จึงต้องทึบ
            stickyHeader && '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-20 [&_thead_th]:bg-slate-50 dark:[&_thead_th]:bg-slate-900',
            // คอลัมน์ที่ตรึงไว้ต้องทึบและเปลี่ยนสีตามแถวด้วย ไม่งั้น hover จะดูเหมือนตารางแตกเป็นสองส่วน
            freezeFirstColumn && [
              '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0',
              '[&_tbody_td:first-child]:z-10 [&_tbody_td:first-child]:bg-white dark:[&_tbody_td:first-child]:bg-slate-800',
              '[&_tbody_tr:hover_td:first-child]:bg-primary-50/50 dark:[&_tbody_tr:hover_td:first-child]:bg-slate-700/40',
              '[&_thead_th:first-child]:z-30 [&_thead_th:first-child]:bg-slate-50 dark:[&_thead_th:first-child]:bg-slate-900',
            ].join(' '),
            cardOnMobile && 'data-table-cards',
            className,
          )}
          {...props}
        >
          {renderedChildren}
        </table>
      </div>
      {!isServerMode && filteredRows.length === 0 && rows.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700">
          ไม่พบข้อมูลที่ตรงกับคำค้นหาหรือตัวกรอง
        </div>
      )}
      {showPagination && (
        <div className="px-4 pb-4">
          <TablePagination page={safePage} pageSize={pageSize} totalItems={filteredRows.length} totalPages={totalPages} itemLabel={itemLabel} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}
      {selectable && selection.length > 0 && (
        <div
          // ลอยเหนือเนื้อหาเสมอ เพราะรายการที่เลือกไว้ข้ามหน้าได้ ผู้ใช้จึงต้องเห็นยอดรวมตลอด
          className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-elevated dark:border-slate-600 dark:bg-slate-800"
          role="status"
        >
          <span className="text-sm font-bold text-slate-700 dark:text-slate-100">
            เลือก {selection.length.toLocaleString('th-TH')} {itemLabel}
          </span>
          {selectionActions}
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelection([])}>
            ล้างการเลือก
          </Button>
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
