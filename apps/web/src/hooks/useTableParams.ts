import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TableSort } from '../components/table/DataTable';

export interface TableParamsOptions<F extends string> {
  /** ชื่อ filter ที่หน้านี้ใช้ — ทุกตัวมีค่าเริ่มต้นเป็นสตริงว่าง */
  filters?: readonly F[];
  defaultPageSize?: number;
}

export interface SetParamOptions {
  /** true = แทนที่รายการใน history แทนการเพิ่มใหม่ ใช้กับช่องที่พิมพ์รัว ๆ อย่างช่องค้นหา */
  replace?: boolean;
}

export interface TableParams<F extends string> {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  filters: Record<F, string>;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sort: TableSort | null) => void;
  setFilter: (key: F, value: string, options?: SetParamOptions) => void;
  setFilters: (values: Partial<Record<F, string>>, options?: SetParamOptions) => void;
  /** ล้าง filter/sort/page ของตาราง โดยไม่แตะ query param อื่นของหน้า (เช่น tab ที่เปิดอยู่) */
  reset: () => void;
}

const PAGE_KEY = 'page';
const SIZE_KEY = 'pageSize';
const SORT_KEY = 'sort';
const ORDER_KEY = 'order';

function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * ผูกสถานะของตาราง (หน้า ขนาดหน้า การเรียง และตัวกรอง) ไว้กับ query string
 *
 * ทำให้ refresh แล้วค่าไม่หาย ส่ง URL ให้คนอื่นเปิดได้หน้าเดียวกัน และปุ่ม Back ย้อนกลับได้จริง
 * ซึ่ง useState ทำไม่ได้เลยสักข้อ
 *
 * ทุก setter ที่เปลี่ยนชุดข้อมูล (filter, sort, pageSize) จะรีเซ็ตกลับหน้า 1 ให้อัตโนมัติ
 * เพราะเป็นจุดที่แต่ละหน้าเคยลืมบ่อยจนผู้ใช้เจอหน้าว่างทั้งที่มีข้อมูล
 *
 * ค่าที่เท่ากับค่าเริ่มต้นจะถูกลบออกจาก URL เพื่อไม่ให้ลิงก์รกไปด้วย page=1&pageSize=10
 */
export function useTableParams<F extends string = string>(
  { filters = [] as readonly F[], defaultPageSize = 10 }: TableParamsOptions<F> = {},
): TableParams<F> {
  const [searchParams, setSearchParams] = useSearchParams();

  const filterKeys = useMemo(() => filters.join(','), [filters]);

  const patch = useCallback(
    (apply: (next: URLSearchParams) => void, options?: SetParamOptions) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        apply(next);
        // ค่าว่างไม่ต้องอยู่ใน URL — ถือว่ากลับไปใช้ค่าเริ่มต้น
        for (const [key, value] of [...next.entries()]) if (value === '') next.delete(key);
        return next;
      }, { replace: options?.replace });
    },
    [setSearchParams],
  );

  const setPage = useCallback((page: number) => {
    patch((next) => { if (page <= 1) next.delete(PAGE_KEY); else next.set(PAGE_KEY, String(page)); });
  }, [patch]);

  const setPageSize = useCallback((pageSize: number) => {
    patch((next) => {
      if (pageSize === defaultPageSize) next.delete(SIZE_KEY);
      else next.set(SIZE_KEY, String(pageSize));
      next.delete(PAGE_KEY);
    });
  }, [patch, defaultPageSize]);

  const setSort = useCallback((sort: TableSort | null) => {
    patch((next) => {
      if (!sort) { next.delete(SORT_KEY); next.delete(ORDER_KEY); }
      else { next.set(SORT_KEY, sort.key); next.set(ORDER_KEY, sort.order); }
      next.delete(PAGE_KEY);
    });
  }, [patch]);

  const setFilters = useCallback((values: Partial<Record<F, string>>, options?: SetParamOptions) => {
    patch((next) => {
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, String(value));
        else next.delete(key);
      }
      next.delete(PAGE_KEY);
    }, options);
  }, [patch]);

  const setFilter = useCallback((key: F, value: string, options?: SetParamOptions) => {
    setFilters({ [key]: value } as Partial<Record<F, string>>, options);
  }, [setFilters]);

  const reset = useCallback(() => {
    patch((next) => {
      for (const key of [PAGE_KEY, SIZE_KEY, SORT_KEY, ORDER_KEY, ...filterKeys.split(',')]) {
        if (key) next.delete(key);
      }
    });
  }, [patch, filterKeys]);

  const sortKey = searchParams.get(SORT_KEY);
  const order = searchParams.get(ORDER_KEY) === 'desc' ? 'desc' : 'asc';

  const filterValues = useMemo(
    () => Object.fromEntries((filterKeys ? filterKeys.split(',') : []).map((key) => [key, searchParams.get(key) ?? ''])) as Record<F, string>,
    [filterKeys, searchParams],
  );

  return {
    page: readPositiveInt(searchParams.get(PAGE_KEY), 1),
    pageSize: readPositiveInt(searchParams.get(SIZE_KEY), defaultPageSize),
    sort: sortKey ? { key: sortKey, order } : null,
    filters: filterValues,
    setPage,
    setPageSize,
    setSort,
    setFilter,
    setFilters,
    reset,
  };
}
