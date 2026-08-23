import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  Bug,
  CloudCog,
  ClipboardList,
  FileKey,
  FilePenLine,
  GitPullRequestArrow,
  GitBranch,
  KeyRound,
  BookOpenCheck,
  Laptop2,
  Layers,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  MessageCircle,
  Network,
  PackageSearch,
  RadioTower,
  ScanLine,
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
  PlugZap,
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
    title: 'พื้นที่ทำงาน',
    items: [
      // route '/' ต้องมี dashboard.view อยู่แล้ว เมนูจึงต้องประกาศให้ตรงกัน ไม่งั้นบาง role กดแล้วเจอ Access Denied
      { label: 'หน้าหลัก', path: '/', icon: LayoutDashboard, permission: 'dashboard.view' },
      { label: 'War Room', path: '/war-room', icon: RadioTower, permission: 'dashboard.view' },
      { label: 'ศูนย์งานของฉัน', path: '/my-work', icon: ClipboardList, permission: 'dashboard.view' },
      { label: 'งานส่วนตัว', path: '/tasks', icon: ListTodo, permission: 'task.view' },
      { label: 'สถานะระบบ', path: '/system-status', icon: Activity },
    ],
  },
  {
    title: 'บริการและกระบวนการ IT',
    items: [
      { label: 'Ticket', path: '/tickets', icon: Ticket, permission: 'ticket.view' },
      { label: 'คำขอบริการ', path: '/service-requests', icon: ShoppingBag, permission: 'service_request.view' },
      { label: 'คำขอสิทธิ์', path: '/access-requests', icon: KeyRound, permission: 'access_request.view' },
      { label: 'Incident', path: '/incidents', icon: Siren, permission: 'incident.view' },
      { label: 'Problem / Known Error', path: '/problems', icon: Bug, permission: 'problem.view' },
      { label: 'Change', path: '/changes', icon: GitPullRequestArrow, permission: 'change.view' },
      { label: 'งานอนุมัติ / Workflow', path: '/workflows', icon: GitBranch, permission: 'workflow.view' },
      { label: 'แบบฟอร์มงาน', path: '/forms', icon: FilePenLine, permission: 'form.view' },
      { label: 'ฐานความรู้', path: '/knowledge', icon: BookOpenCheck, permission: 'knowledge.view' },
    ],
  },
  {
    title: 'ทรัพย์สินและโครงสร้างพื้นฐาน',
    items: [
      { label: 'ทะเบียนทรัพย์สิน', path: '/assets', icon: Boxes, permission: 'asset.view' },
      { label: 'ยืม / คืน Asset', path: '/asset-borrow', icon: ArrowLeftRight, permission: 'asset.view' },
      {
        label: 'เบิกจ่ายทรัพย์สิน',
        path: '/admin/employee-assignments',
        icon: Laptop2,
        anyPermission: ['employee.manage', 'asset.view'],
      },
      { label: 'PM / บำรุงรักษา', path: '/maintenance', icon: Wrench, permission: 'maintenance.view' },
      { label: 'สแกนหน้างาน', path: '/field/scan', icon: ScanLine, permission: 'asset.view' },
      { label: 'Inventory', path: '/inventory-items', icon: PackageSearch, permission: 'inventory.view' },
      { label: 'Software License', path: '/software-licenses', icon: FileKey, permission: 'license.view' },
      { label: 'CMDB', path: '/cmdb', icon: Network, permission: 'cmdb.view' },
      { label: 'ความสัมพันธ์ CI', path: '/cmdb/relationships', icon: Waypoints, permission: 'cmdb.view' },
      { label: 'Backup & Monitoring', path: '/backup-monitoring', icon: CloudCog, anyPermission: ['backup.view', 'monitoring.view'] },
      { label: 'Vulnerability & Patch', path: '/vulnerabilities', icon: ShieldAlert, permission: 'vulnerability.view' },
      { label: 'Vendor & Contract', path: '/vendors-contracts', icon: Building2, anyPermission: ['vendor.view', 'contract.view'] },
    ],
  },
  {
    title: 'ธรรมาภิบาลและรายงาน',
    items: [
      {
        label: 'Governance Center', path: '/governance', icon: ShieldCheck,
        anyPermission: ['data_class.view', 'compliance.view', 'privacy.view', 'risk.view', 'ai_cloud.view', 'awareness.view', 'evidence.view', 'audit_management.view', 'governance_document.view', 'operations.view', 'integration.view'],
      },
      { label: 'Report Center', path: '/reports', icon: BarChart3, permission: 'report.view' },
      { label: 'Audit Log', path: '/admin/audit-logs', icon: ClipboardList, permission: 'audit.view' },
    ],
  },
  {
    title: 'บุคลากรและสิทธิ์',
    items: [
      { label: 'ผู้ใช้งาน', path: '/admin/users', icon: Users, permission: 'user.manage' },
      { label: 'พนักงาน', path: '/admin/employees', icon: UserSquare2, permission: 'employee.manage' },
      { label: 'ตารางทักษะช่าง', path: '/admin/technician-skills', icon: Layers, permission: 'technician_skill.view' },
      { label: 'บทบาท', path: '/admin/roles', icon: ShieldCheck, permission: 'role.view' },
      { label: 'Permission Matrix', path: '/admin/permission-matrix', icon: KeyRound, permission: 'role.view' },
      { label: 'ทะเบียนสิทธิ์ RBAC', path: '/admin/access-registry', icon: ListChecks, permission: 'access_registry.manage' },
      { label: 'กลุ่มอนุมัติ', path: '/admin/approval-groups', icon: Users2, permission: 'approval_group.manage' },
      { label: 'บัญชี LINE ที่ผูก', path: '/admin/line-links', icon: MessageCircle, permission: 'line.manage' },
    ],
  },
  {
    title: 'ตั้งค่าและบัญชี',
    items: [
      {
        label: 'Master Data',
        path: '/admin/master-data',
        icon: Tags,
        anyPermission: ['ticket_category.manage', 'asset_category.manage', 'access_system.manage'],
      },
      { label: 'Service Catalog', path: '/admin/service-catalog', icon: ShoppingBag, permission: 'service_catalog.manage' },
      { label: 'System Settings', path: '/admin/settings', icon: Settings, permission: 'setting.view' },
      { label: 'การเชื่อมต่อ', path: '/admin/integrations', icon: PlugZap, permission: 'integration.view' },
      { label: 'โปรไฟล์ของฉัน', path: '/profile', icon: UserCircle },
    ],
  },
];
