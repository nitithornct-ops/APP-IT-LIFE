import type { SortQuery } from '@itlife/shared';

/** ส่วนของ query builder ของ supabase-js ที่ applySort ต้องใช้ (แยกไว้เพื่อให้เทสต์ได้โดยไม่ต้องต่อ DB) */
export interface SortableQuery<T> {
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean }): T;
}

export interface SortFallback {
  column: string;
  /** ค่าเริ่มต้น false เพราะลิสต์ส่วนใหญ่เรียงของใหม่ขึ้นก่อน */
  ascending?: boolean;
}

/**
 * ใส่ ORDER BY ให้ query โดยรับชื่อคอลัมน์จากผู้ใช้ได้เฉพาะที่อยู่ใน allowlist เท่านั้น
 *
 * allowlist เป็นสิ่งบังคับ ไม่ใช่ทางเลือก — ชื่อคอลัมน์จาก query string ถูกต่อเข้าไปใน
 * PostgREST โดยตรง ถ้าไม่กรองก่อนจะเปิดให้เรียงตามคอลัมน์ที่ไม่ควรเปิดเผย
 * (หรือคอลัมน์ของตารางที่ join มา) ได้
 *
 * ค่า sort ที่ไม่อยู่ใน allowlist จะตกกลับไปใช้ fallback แทนการตอบ 400 เพราะ URL ที่ผู้ใช้
 * bookmark ไว้อาจอ้างคอลัมน์เก่าที่ถูกเปลี่ยนชื่อไปแล้ว — ลิสต์ที่เรียงไม่ตรงใจยังใช้งานได้
 * แต่หน้าที่พังทั้งหน้าใช้ไม่ได้เลย
 *
 * เมื่อเรียงตามคอลัมน์ที่ค่าซ้ำกันได้ (สถานะ ความเร่งด่วน ฯลฯ) จะเติม fallback เป็นตัวตัดสิน
 * ลำดับรองให้เสมอ ไม่งั้นแถวจะสลับตำแหน่งกันเองระหว่างหน้า ทำให้บางแถวโผล่สองหน้าและบางแถวหายไป
 */
export function applySort<T extends SortableQuery<T>>(
  query: T,
  { sort, order }: SortQuery,
  allowlist: readonly string[],
  fallback: SortFallback,
): T {
  const fallbackAscending = fallback.ascending ?? false;
  const column = sort && allowlist.includes(sort) ? sort : null;
  if (!column) return query.order(fallback.column, { ascending: fallbackAscending, nullsFirst: false });

  // nullsFirst: false ทั้งสองทิศ เพื่อให้แถวที่ไม่มีค่า (เช่น Ticket ที่ยังไม่มีกำหนด SLA)
  // ไปอยู่ท้ายเสมอ แทนที่จะเด้งขึ้นหัวตารางเมื่อกดเรียงจากมากไปน้อย
  const sorted = query.order(column, { ascending: order !== 'desc', nullsFirst: false });
  if (column === fallback.column) return sorted;
  return sorted.order(fallback.column, { ascending: fallbackAscending, nullsFirst: false });
}
