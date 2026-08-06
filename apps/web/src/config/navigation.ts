import { Activity, ClipboardList, KeyRound, LayoutDashboard, ShieldCheck, UserCircle, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** ไม่ระบุ = ทุกคนที่ login แล้วเห็นได้ */
  permission?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** แหล่งเดียวของเมนู ใช้ทั้ง Sidebar และ Command Palette (Ctrl+K) — เพิ่มเมนูใหม่ที่นี่ที่เดียว */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'ภาพรวม',
    items: [
      { label: 'หน้าหลัก', path: '/', icon: LayoutDashboard },
      { label: 'สถานะระบบ', path: '/health', icon: Activity },
    ],
  },
  {
    title: 'บัญชีของฉัน',
    items: [{ label: 'โปรไฟล์', path: '/profile', icon: UserCircle }],
  },
  {
    title: 'การดูแลระบบ',
    items: [
      { label: 'ผู้ใช้งาน', path: '/admin/users', icon: Users, permission: 'user.manage' },
      { label: 'บทบาท', path: '/admin/roles', icon: ShieldCheck, permission: 'role.view' },
      { label: 'Permission Matrix', path: '/admin/permission-matrix', icon: KeyRound, permission: 'role.view' },
      { label: 'Audit Log', path: '/admin/audit-logs', icon: ClipboardList, permission: 'audit.view' },
    ],
  },
];
