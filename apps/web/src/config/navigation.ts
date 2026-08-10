import {
  Activity,
  BarChart3,
  Boxes,
  Building2,
  Bug,
  CloudCog,
  ClipboardList,
  FileKey,
  GitPullRequestArrow,
  GitBranch,
  KeyRound,
  BookOpenCheck,
  Laptop2,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Network,
  PackageSearch,
  ShieldCheck,
  ShieldAlert,
  Settings,
  Siren,
  ShoppingBag,
  Tags,
  Ticket,
  UserCircle,
  Users,
  Users2,
  UserSquare2,
  Waypoints,
  Wrench,
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
    title: 'บริการ',
    items: [
      { label: 'งานของฉัน', path: '/tasks', icon: ListTodo, permission: 'task.view' },
      { label: 'Ticket', path: '/tickets', icon: Ticket, permission: 'ticket.view' },
      { label: 'คำขอบริการ', path: '/service-requests', icon: ShoppingBag, permission: 'service_request.view' },
      { label: 'คำขอสิทธิ์ระบบ', path: '/access-requests', icon: KeyRound, permission: 'access_request.view' },
      { label: 'Incident', path: '/incidents', icon: Siren, permission: 'incident.view' },
      { label: 'Problem / Known Error', path: '/problems', icon: Bug, permission: 'problem.view' },
      { label: 'Change Management', path: '/changes', icon: GitPullRequestArrow, permission: 'change.view' },
      { label: 'Workflow / งานอนุมัติ', path: '/workflows', icon: GitBranch, permission: 'workflow.view' },
      { label: 'ฐานความรู้', path: '/knowledge', icon: BookOpenCheck, permission: 'knowledge.view' },
    ],
  },
  {
    title: 'บัญชีของฉัน',
    items: [{ label: 'โปรไฟล์', path: '/profile', icon: UserCircle }],
  },
  {
    title: 'ธรรมาภิบาล กฎหมาย และ ISMS',
    items: [
      { label: 'Report Center', path: '/reports', icon: BarChart3, permission: 'report.view' },
      {
        label: 'Governance Center', path: '/governance', icon: ShieldCheck,
        anyPermission: ['data_class.view', 'compliance.view', 'privacy.view', 'risk.view', 'ai_cloud.view', 'awareness.view', 'evidence.view', 'audit_management.view', 'governance_document.view', 'operations.view', 'integration.view'],
      },
    ],
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
      {
        label: 'ทรัพย์สินพนักงาน',
        path: '/admin/employee-assignments',
        icon: Laptop2,
        anyPermission: ['employee.manage', 'asset.view'],
      },
      { label: 'ทะเบียนทรัพย์สิน IT', path: '/assets', icon: Boxes, permission: 'asset.view' },
      { label: 'PM / บำรุงรักษา', path: '/maintenance', icon: Wrench, permission: 'maintenance.view' },
      { label: 'Inventory', path: '/inventory-items', icon: PackageSearch, permission: 'inventory.view' },
      { label: 'Software License', path: '/software-licenses', icon: FileKey, permission: 'license.view' },
      { label: 'Vulnerability / Patch', path: '/vulnerabilities', icon: ShieldAlert, permission: 'vulnerability.view' },
      { label: 'Backup / Monitoring', path: '/backup-monitoring', icon: CloudCog, anyPermission: ['backup.view', 'monitoring.view'] },
      { label: 'Vendor / Contract', path: '/vendors-contracts', icon: Building2, anyPermission: ['vendor.view', 'contract.view'] },
      { label: 'CMDB', path: '/cmdb', icon: Network, permission: 'cmdb.view' },
      { label: 'ความสัมพันธ์ CI', path: '/cmdb/relationships', icon: Waypoints, permission: 'cmdb.view' },
      { label: 'Service Catalog', path: '/admin/service-catalog', icon: ShoppingBag, permission: 'service_catalog.manage' },
      { label: 'ทะเบียนสิทธิ์ RBAC', path: '/admin/access-registry', icon: ListChecks, permission: 'access_registry.manage' },
      { label: 'กลุ่มอนุมัติ', path: '/admin/approval-groups', icon: Users2, permission: 'approval_group.manage' },
      { label: 'Audit Log', path: '/admin/audit-logs', icon: ClipboardList, permission: 'audit.view' },
      { label: 'System Settings', path: '/admin/settings', icon: Settings, permission: 'setting.view' },
    ],
  },
];
