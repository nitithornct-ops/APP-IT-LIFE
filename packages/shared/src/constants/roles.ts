/**
 * บทบาทเริ่มต้นของระบบ (Configurable RBAC) — เป็นค่าเริ่มต้นที่ seed ตอนติดตั้งเท่านั้น
 * บทบาทจริงถูกจัดการผ่านตาราง roles ใน Database ไม่ hard-code สิทธิ์ไว้ที่ Frontend
 */
export const DEFAULT_ROLE_KEYS = [
  'super_admin',
  'it_admin',
  'technician',
  'approver',
  'manager',
  'executive',
  'auditor',
  'dpo',
  'user',
] as const;

export type DefaultRoleKey = (typeof DEFAULT_ROLE_KEYS)[number];
