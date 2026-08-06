/** ต่อ className แบบง่าย ตัดค่าที่เป็น falsy ออก — ไม่เพิ่ม dependency ภายนอกสำหรับงานเล็กเท่านี้ */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
