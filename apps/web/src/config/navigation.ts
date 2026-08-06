import {
  Activity,
  ClipboardList,
  KeyRound,
  LayoutDashboard,
  ShieldCheck,
  Tags,
  UserCircle,
  Users,
  Users2,
  UserSquare2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** ไม่ระบุ permission และ anyPermission ทั้งคู่ = ทุกคนที่ login แล้วเห็นได้ */
  permission?: string;
  /** เห็นเมนูถ้ามีสิทธิ์อย่างน้อยหนึ่งในรายการนี้ (ใช้เมื่อหน้าเดียวรวมหลาย permission เช่น Master Data) */
  anyPermission?: string[];
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
      {
        label: 'Master Data',
        path: '/admin/master-data',
        icon: Tags,
        anyPermission: ['ticket_category.manage', 'asset_category.manage'],
      },
      { label: 'พนักงาน', path: '/admin/employees', icon: UserSquare2, permission: 'employee.manage' },
      { label: 'กลุ่มอนุมัติ', path: '/admin/approval-groups', icon: Users2, permission: 'approval_group.manage' },
      { label: 'Audit Log', path: '/admin/audit-logs', icon: ClipboardList, permission: 'audit.view' },
    ],
  },
];
