/**
 * ตัวอย่าง Permission key เริ่มต้น (รูปแบบ `module.action`) — seed ตอนติดตั้งเท่านั้น
 * รายการจริงถูกจัดการผ่านตาราง permissions/role_permissions ใน Database (Permission Matrix)
 * Frontend ใช้ค่าเหล่านี้เพื่อซ่อน/ปิดเมนูเท่านั้น ไม่ใช่แหล่งความจริงของสิทธิ์ — Backend ต้องตรวจซ้ำทุกครั้ง
 */
export const DEFAULT_PERMISSION_KEYS = [
  'dashboard.view',
  'ticket.view',
  'ticket.create',
  'ticket.update',
  'ticket.assign',
  'ticket.close',
  'asset.view',
  'asset.create',
  'asset.update',
  'asset.transfer',
  'asset.dispose',
  'incident.view',
  'incident.manage',
  'report.export',
  'user.manage',
  'role.manage',
  'role.view',
  'department.manage',
  'position.manage',
  'audit.view',
] as const;

export type DefaultPermissionKey = (typeof DEFAULT_PERMISSION_KEYS)[number];
