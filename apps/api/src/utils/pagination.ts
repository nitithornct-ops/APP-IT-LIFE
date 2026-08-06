import type { PaginatedData } from '@itlife/shared';

/** แปลง page/pageSize (เริ่มที่ 1) เป็น [from, to] แบบ 0-based ที่ .range() ของ supabase-js ต้องการ */
export function paginationRange(page: number, pageSize: number): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

export function toPaginatedData<T>(
  items: T[],
  count: number | null,
  page: number,
  pageSize: number,
): PaginatedData<T> {
  const totalItems = count ?? 0;
  return {
    items,
    pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
  };
}
