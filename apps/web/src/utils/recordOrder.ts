/**
 * เรียงรายการจากใหม่ไปเก่าตามเวลาที่สร้าง — ลำดับมาตรฐานของตารางทุกโมดูล
 *
 * ใช้กับตารางที่กินข้อมูลจาก endpoint ที่ dropdown/ตัวเลือกอื่นใช้ร่วมด้วย ซึ่งยังต้องเรียงตามชื่อ
 * เพื่อให้ผู้ใช้ไล่หาในรายการยาว ๆ เจอ จึงจัดลำดับใหม่ที่หน้าจอแทนการเปลี่ยนลำดับของ API
 * ส่วนตารางที่มี endpoint ของตัวเอง ให้ API เรียงมาให้เลย เพราะการแบ่งหน้าเกิดฝั่ง server
 *
 * แถวที่ไม่มี created_at ถูกดันไปท้ายเสมอ เหมือน nullsFirst: false ของฝั่ง API
 */
export function sortNewestFirst<T extends { created_at?: string | null }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at));
}

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
