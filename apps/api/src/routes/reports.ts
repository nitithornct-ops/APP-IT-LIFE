import { csvCell } from '@itlife/shared';
import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderHtmlToPdf } from '../lib/pdf';
import { renderExecutivePackHtml, renderReportHtml } from '../lib/reportPdfTemplate';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import { ticketSlaState } from '../services/ticketSlaStatus';
import { buddhistYearFolder, googleDriveConfig, safeDriveName, uploadCsvAsGoogleSheet, uploadToDrive } from '../services/googleDriveService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { zodValidationHook } from '../utils/validation';
import {
  reportExecutivePackQuerySchema,
  reportExecutivePackExportSchema,
  reportExportSchema,
  reportExecutivePackSnapshotSchema,
  reportPdfExportSchema,
  reportRangeQuerySchema,
  reportSavedFilterQuerySchema,
  reportSavedFilterSchema,
  reportSchedulePatchSchema,
  reportScheduleSchema,
  reportSnapshotSchema,
} from '../validators/reports';

type Row = Record<string, unknown>;
type ReportKey = 'service-desk' | 'requests-workflows' | 'assets-operations' | 'asset-custody' | 'asset-verification' | 'security-resilience' | 'governance-compliance';
type Tone = 'primary' | 'teal' | 'amber' | 'danger' | 'gray';

interface ReportDefinition {
  key: ReportKey;
  label: string;
  description: string;
  sourcePermissions: string[];
  sortOrder: number;
}

interface ReportEntry {
  row: Record<string, string | number | boolean | null>;
  createdAt: string;
  completedAt?: string;
  terminal: boolean;
  overdue: boolean;
  warning: boolean;
  critical: boolean;
  paused: boolean;
  amount?: number;
  rating?: number;
  feedback?: string;
  feedbackAt?: string;
}

export interface ReportFilters {
  rangeDays: number;
  departmentId?: string;
  ownerId?: string;
  from?: string;
  to?: string;
  comparePrevious?: boolean;
}

export interface ReportFreshness {
  source: string;
  lastUpdatedAt: string | null;
  status: 'fresh' | 'stale' | 'unknown';
}

export interface ReportComparison {
  label: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  deltaPercentage: number | null;
}

export interface ExecutivePack {
  reportKey: 'executive-pack';
  title: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  metrics: ReturnType<typeof metric>[];
  comparison: ReportComparison[];
  freshness: ReportFreshness[];
  sections: Array<{ key: ReportKey; label: string; totalRows: number; metrics: ReturnType<typeof metric>[]; alerts: string[] }>;
  kpis: Array<{ key: string; label: string; description: string; formula: string; unit: string; target: number | null; direction: string }>;
}

interface ScheduledArtifact {
  name: string | null;
  driveId: string | null;
  driveUrl: string | null;
  error: string | null;
}

export interface CsatEntryInput {
  id: string;
  code: string;
  title: string;
  category: string;
  owner: string;
  rating?: number;
  feedback?: string;
  feedbackAt?: string;
  createdAt: string;
}

interface ReportColumn {
  key: string;
  label: string;
}

/** ชื่อ/รหัส/หน่วยงานของพนักงานหนึ่งคน เท่าที่รายงานต้องใช้ — ไม่มี PII อย่าง email หรือบัญชี AD */
interface DirectoryEntry {
  name: string;
  code: string;
  department: string;
  departmentId?: string;
}

export type Directory = Map<string, DirectoryEntry>;

interface SourceConfig {
  /** สิทธิ์ที่เปิดให้เห็นแหล่งข้อมูลนี้ — ใส่เป็น array ได้เมื่อ RLS ของตารางยอมรับหลายสาย (any-of) */
  permission: string | string[];
  table: string;
  select: string;
  dateColumn: string;
  sourceLabel: string;
  map: (row: Row, directory: Directory) => ReportEntry;
  currentState?: boolean;
  /** แหล่งนี้เก็บพนักงานเป็น uuid จึงต้องใช้ทะเบียนชื่อมาแปลงก่อนแสดง — ดู loadDirectory */
  directory?: boolean;
}

interface ReportConfig extends ReportDefinition {
  sources: SourceConfig[];
  /** ทับชุดคอลัมน์มาตรฐาน สำหรับรายงานที่มีรูปแบบเฉพาะของตัวเอง */
  columns?: ReportColumn[];
}

/**
 * สถานะที่ถือว่า "ของยังอยู่กับพนักงานคนนี้" — ต้องตรงกับ CURRENT_STATUSES ของ
 * routes/employeeAssignments.ts และตัวนับใน routes/employees.ts เป๊ะ ๆ ไม่งั้นตัวเลข
 * "พนักงานที่ถือครอง" ในรายงานจะไม่ตรงกับ "มีทรัพย์สินครอบครอง" ในหน้าพนักงาน
 * (ของที่แจ้งสูญหายไม่นับว่าถือครอง — มันมีตัวนับของตัวเองอยู่แล้ว)
 */
const CUSTODY_HOLDING_STATUSES = ['ครอบครอง', 'ส่งซ่อม'];

const TERMINAL = /ปิด|เสร็จ|สำเร็จ|อนุมัติแล้ว|ยกเลิก|ปฏิเสธ|ผ่าน|inactive|expired|closed|completed|cancelled/i;

function value(row: Row, key: string): string { return row[key] === null || row[key] === undefined ? '' : String(row[key]); }
function numeric(row: Row, key: string): number { const result = Number(row[key]); return Number.isFinite(result) ? result : 0; }
function shortId(row: Row, prefix: string): string { return `${prefix}-${value(row, 'id').slice(0, 8).toUpperCase()}`; }
function relatedValue(row: Row, key: string, field = 'name'): string {
  const relation = row[key];
  const record = Array.isArray(relation) ? relation[0] : relation;
  return record && typeof record === 'object' && field in record ? String((record as Row)[field] ?? '') : '';
}
function person(directory: Directory, id: unknown): DirectoryEntry {
  return directory.get(String(id ?? '')) ?? { name: '', code: '', department: '', departmentId: '' };
}
function dateLabel(input: unknown): string {
  if (!input) return '—';
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? String(input) : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(date);
}
function isOverdue(due: unknown, terminal: boolean, paused = false): boolean {
  if (!due || terminal || paused) return false;
  const time = new Date(String(due)).getTime();
  return Number.isFinite(time) && time < Date.now();
}

function standardEntry(args: {
  row: Row; source: string; code: string; title: string; status: string; category?: string;
  owner?: string; ownerId?: unknown; department?: string; departmentId?: unknown;
  due?: unknown; created?: unknown; completed?: unknown; warning?: boolean; paused?: boolean;
  critical?: boolean; amount?: number; rating?: number; feedback?: string; feedbackAt?: string;
  extraRow?: Record<string, string | number | boolean | null>; terminal?: boolean;
}): ReportEntry {
  // บางชุดสถานะไม่เข้ากับ TERMINAL (เช่น 'คืนแล้ว' ของทะเบียนคุม) จึงให้แหล่งข้อมูลระบุเองได้
  const terminal = args.terminal ?? TERMINAL.test(args.status);
  const createdAt = args.created ? String(args.created) : new Date(0).toISOString();
  const inferredOwnerId = args.ownerId ?? args.row.assignee_id ?? args.row.it_handler_id ?? args.row.technician_id
    ?? args.row.owner_id ?? args.row.operator_id ?? args.row.tester_id ?? args.row.owner_employee_id ?? args.row.employee_id;
  const inferredDepartmentId = args.departmentId ?? args.row.department_id;
  return {
    row: {
      id: value(args.row, 'id'), source: args.source, code: args.code, title: args.title, status: args.status || '—',
      category: args.category || '—', owner: args.owner || '—', ownerId: inferredOwnerId == null ? null : String(inferredOwnerId),
      department: args.department || '—', departmentId: inferredDepartmentId == null ? null : String(inferredDepartmentId),
      dueDate: dateLabel(args.due), recordDate: dateLabel(args.created),
      ...args.extraRow,
    },
    createdAt,
    completedAt: args.completed ? String(args.completed) : undefined,
    terminal,
    paused: Boolean(args.paused),
    overdue: isOverdue(args.due, terminal, args.paused),
    warning: Boolean(args.warning),
    critical: Boolean(args.critical),
    amount: args.amount,
    rating: args.rating,
    feedback: args.feedback,
    feedbackAt: args.feedbackAt,
  };
}

export const REPORTS: Record<ReportKey, ReportConfig> = {
  'service-desk': {
    key: 'service-desk', label: 'Service Desk', sortOrder: 10,
    description: 'ปริมาณงาน สถานะ SLA ความเร่งด่วน และความพึงพอใจของ Ticket',
    sourcePermissions: ['ticket.view'],
    sources: [{
      permission: 'ticket.view', table: 'tickets', dateColumn: 'created_at', sourceLabel: 'Ticket',
      select: 'id,ticket_no,title,priority,status,due_at,sla_paused_at,response_due_at,acknowledged_at,resolved_at,closed_at,rating,feedback,feedback_at,created_at,assignee_id,assignee_name_snapshot,ticket_categories(name)',
      map: (row) => standardEntry({
        row,
        source: 'Ticket',
        code: value(row, 'ticket_no') || shortId(row, 'TKT'),
        title: value(row, 'title'),
        status: value(row, 'status'),
        category: relatedValue(row, 'ticket_categories') || value(row, 'priority'),
        owner: value(row, 'assignee_name_snapshot') || value(row, 'assignee_id'),
        due: row.due_at,
        paused: Boolean(row.sla_paused_at),
        created: row.created_at,
        completed: row.closed_at ?? row.resolved_at,
        critical: value(row, 'priority') === 'วิกฤต',
        rating: row.rating === null ? undefined : numeric(row, 'rating'),
        feedback: value(row, 'feedback') || undefined,
        feedbackAt: value(row, 'feedback_at') || undefined,
        extraRow: {
          priority: value(row, 'priority') || '—',
          rating: row.rating === null ? null : numeric(row, 'rating'),
          feedback: value(row, 'feedback') || '—',
          feedbackDate: dateLabel(row.feedback_at),
          slaState: row.sla_paused_at ? 'พัก SLA' : ticketSlaState(row),
        },
      }),
    }],
  },
  'requests-workflows': {
    key: 'requests-workflows', label: 'Requests & Workflows', sortOrder: 20,
    description: 'คำขอบริการ คำขอสิทธิ์ และกระบวนการอนุมัติในมุมมองเดียว',
    sourcePermissions: ['service_request.view', 'access_request.view', 'workflow.view'],
    sources: [
      { permission: 'service_request.view', table: 'service_requests', dateColumn: 'created_at', sourceLabel: 'Service Request', select: 'id,service_code,service_name,summary,priority,status,approval_status,due_at,closed_at,completed_at,created_at,assignee_id', map: (row) => standardEntry({ row, source: 'Service Request', code: value(row, 'service_code') || shortId(row, 'SR'), title: value(row, 'summary') || value(row, 'service_name'), status: value(row, 'status'), category: value(row, 'priority'), owner: value(row, 'assignee_id'), due: row.due_at, created: row.created_at, completed: row.closed_at ?? row.completed_at }) },
      { permission: 'access_request.view', table: 'access_requests', dateColumn: 'created_at', sourceLabel: 'Access Request', select: 'id,request_type,access_level,status,review_due,created_at,approved_at,it_action_at,it_handler_id,lifecycle_event,privileged_access,data_classification,access_control_item:access_control_items!access_requests_access_item_id_fkey(kind,name)', map: (row) => { const item = row.access_control_item as { kind?: string; name?: string } | null; const itemLabel = item?.name ? `${item.kind?.toUpperCase() ?? 'RBAC'} · ${item.name}` : value(row, 'access_level'); return standardEntry({ row, source: 'Access Request', code: shortId(row, 'AR'), title: `${value(row, 'request_type')} · ${itemLabel}`, status: value(row, 'status'), category: itemLabel, owner: value(row, 'it_handler_id'), due: row.review_due, created: row.created_at, completed: row.it_action_at }); } },
      { permission: 'workflow.view', table: 'workflow_instances', dateColumn: 'created_at', sourceLabel: 'Workflow', select: 'id,instance_code,module_key,record_label,status,due_at,started_at,completed_at,created_at,requester_id', map: (row) => standardEntry({ row, source: 'Workflow', code: value(row, 'instance_code'), title: value(row, 'record_label'), status: value(row, 'status'), category: value(row, 'module_key'), owner: value(row, 'requester_id'), due: row.due_at, created: row.started_at ?? row.created_at, completed: row.completed_at }) },
    ],
  },
  'assets-operations': {
    key: 'assets-operations', label: 'Assets & Operations', sortOrder: 30,
    description: 'สินทรัพย์ แผนบำรุงรักษา สต็อก และ License ที่ต้องดูแล',
    sourcePermissions: ['asset.view', 'maintenance.view', 'inventory.view', 'license.view'],
    sources: [
      { permission: 'asset.view', table: 'assets', dateColumn: 'created_at', sourceLabel: 'Asset', currentState: true, directory: true, select: 'id,asset_code,name,asset_type,status,warranty_expire,price,created_at,owner_employee_id', map: (row, directory) => standardEntry({ row, source: 'Asset', code: value(row, 'asset_code'), title: value(row, 'name'), status: value(row, 'status'), category: value(row, 'asset_type'), owner: person(directory, row.owner_employee_id).name, due: row.warranty_expire, created: row.created_at, warning: isOverdue(row.warranty_expire, false), amount: numeric(row, 'price') }) },
      { permission: 'maintenance.view', table: 'maintenance_plans', dateColumn: 'created_at', sourceLabel: 'Maintenance', currentState: true, directory: true, select: 'id,status,recurrence,recurrence_basis,original_plan_date,plan_date,actual_date,next_due_date,created_at,technician_id,asset_id', map: (row, directory) => standardEntry({ row, source: 'Maintenance', code: shortId(row, 'PM'), title: `แผนบำรุงรักษา ${value(row, 'asset_id').slice(0, 8)}`, status: value(row, 'status'), category: `${value(row, 'recurrence')} · ยึด${value(row, 'recurrence_basis')}`, owner: person(directory, row.technician_id).name, due: row.next_due_date ?? row.plan_date, created: row.original_plan_date ?? row.created_at, completed: row.actual_date }) },
      { permission: 'inventory.view', table: 'inventory_items', dateColumn: 'created_at', sourceLabel: 'Inventory', currentState: true, select: 'id,item_name,category,unit,stock_qty,min_qty,location,status,unit_price,created_at', map: (row) => standardEntry({ row, source: 'Inventory', code: shortId(row, 'INV'), title: value(row, 'item_name'), status: value(row, 'status'), category: value(row, 'category'), owner: value(row, 'location'), created: row.created_at, warning: numeric(row, 'stock_qty') <= numeric(row, 'min_qty'), amount: numeric(row, 'stock_qty') * numeric(row, 'unit_price') }) },
      { permission: 'license.view', table: 'software_licenses', dateColumn: 'created_at', sourceLabel: 'License', currentState: true, select: 'id,software_name,license_type,total_qty,used_qty,expire_date,vendor_name,status,created_at', map: (row) => standardEntry({ row, source: 'License', code: shortId(row, 'LIC'), title: value(row, 'software_name'), status: value(row, 'status'), category: value(row, 'license_type'), owner: value(row, 'vendor_name'), due: row.expire_date, created: row.created_at, warning: isOverdue(row.expire_date, false) || numeric(row, 'used_qty') >= numeric(row, 'total_qty') }) },
    ],
  },
  /**
   * ทะเบียนคุมทรัพย์สินรายพนักงาน — ตอบคำถามคนละข้อกับ Assets & Operations
   * ข้างบนตอบว่า "ของชิ้นนี้อยู่ในสภาพไหน" ส่วนหน้านี้ตอบว่า "ใครถืออะไรอยู่" จึงยึด
   * employee_assignments เป็นแกน (หนึ่งแถวต่อหนึ่งรายการที่ถือครอง) ไม่ใช่ตาราง assets
   * เพราะของที่พนักงานถือมีทั้งที่ขึ้นทะเบียนกลางและรายการอิสระอย่าง License
   */
  'asset-custody': {
    key: 'asset-custody', label: 'ทะเบียนคุมทรัพย์สินรายพนักงาน', sortOrder: 35,
    description: 'พนักงานแต่ละคนถือครองอุปกรณ์และสิทธิ์ใช้งานอะไรอยู่บ้าง สำหรับตรวจนับและใช้เป็นใบทะเบียนคุม',
    sourcePermissions: ['employee.manage', 'asset.view'],
    columns: [
      { key: 'employeeCode', label: 'รหัสพนักงาน' }, { key: 'owner', label: 'ผู้ถือครอง' }, { key: 'department', label: 'หน่วยงาน' },
      { key: 'category', label: 'ประเภท' }, { key: 'title', label: 'รายการ' }, { key: 'code', label: 'รหัสทรัพย์สิน' },
      { key: 'serialNumber', label: 'Serial / หมายเลขเครื่อง' }, { key: 'status', label: 'สถานะ' },
      { key: 'assignedDate', label: 'วันที่รับมอบ' }, { key: 'returnedDate', label: 'วันที่คืน' },
    ],
    sources: [
      {
        // RLS ของตารางนี้เปิดให้ทั้งสายทะเบียนพนักงานและสายงาน IT Asset จึงตรวจแบบ any-of ให้ตรงกัน
        permission: ['employee.manage', 'asset.view'], table: 'employee_assignments', dateColumn: 'created_at',
        sourceLabel: 'Assignment', currentState: true, directory: true,
        select: 'id,employee_id,category,item_name,asset_code,asset_number,serial_number,mac_address,status,assigned_date,returned_date,created_at,asset:assets(asset_code)',
        map: (row, directory) => {
          const holder = person(directory, row.employee_id);
          const status = value(row, 'status');
          return standardEntry({
            row, source: 'ทะเบียนคุม',
            // ของที่ขึ้นทะเบียนกลางให้ยึดรหัสจริงจาก assets ส่วนรายการอิสระใช้รหัสที่กรอกไว้เอง
            code: relatedValue(row, 'asset', 'asset_code') || value(row, 'asset_code') || value(row, 'asset_number'),
            title: value(row, 'item_name'), status, category: value(row, 'category'), owner: holder.name,
            created: row.assigned_date ?? row.created_at, completed: row.returned_date,
            terminal: status === 'คืนแล้ว', warning: status === 'ส่งซ่อม', critical: status === 'สูญหาย',
            extraRow: {
              employeeId: value(row, 'employee_id'), employeeCode: holder.code, department: holder.department,
              serialNumber: value(row, 'serial_number') || value(row, 'mac_address'),
              // วันที่รับมอบต้องมาจาก assigned_date เท่านั้น — created_at คือวันที่คีย์เข้าระบบ ไม่ใช่วันที่ส่งมอบจริง
              assignedDate: dateLabel(row.assigned_date), returnedDate: dateLabel(row.returned_date),
            },
          });
        },
      },
    ],
  },
  'asset-verification': {
    key: 'asset-verification', label: 'Asset Verification', sortOrder: 36,
    description: 'ผลตรวจนับทรัพย์สินจาก Campaign หน้างาน พร้อมสถานที่ ผู้ถือครอง และหลักฐานที่ต้องติดตาม',
    sourcePermissions: ['asset.view'],
    columns: [
      { key: 'campaignCode', label: 'Campaign' }, { key: 'campaignName', label: 'ชื่อ Campaign' },
      { key: 'code', label: 'รหัสทรัพย์สิน' }, { key: 'title', label: 'ทรัพย์สิน' },
      { key: 'status', label: 'ผลตรวจ' }, { key: 'expectedLocation', label: 'สถานที่ตามทะเบียน' },
      { key: 'actualLocation', label: 'สถานที่พบจริง' }, { key: 'expectedCustodian', label: 'ผู้ถือครองตามทะเบียน' },
      { key: 'actualCustodian', label: 'ผู้ถือครองปัจจุบัน' }, { key: 'recordDate', label: 'วันที่สแกน' },
      { key: 'note', label: 'หมายเหตุ' },
    ],
    sources: [{
      permission: 'asset.view', table: 'asset_verifications', dateColumn: 'scanned_at', sourceLabel: 'Asset Verification',
      select: 'id,result,expected_location,actual_location,expected_custodian_employee_id,actual_custodian_employee_id,note,scanned_at,asset:assets!asset_verifications_asset_id_fkey(asset_code,name),campaign:asset_verification_campaigns!asset_verifications_campaign_id_fkey(campaign_code,name)',
      currentState: false, directory: true,
      map: (row, directory) => {
        const asset = row.asset as Row | null;
        const campaign = row.campaign as Row | null;
        const result = value(row, 'result');
        const resultLabels: Record<string, string> = { found: 'พบ / ตรงข้อมูล', not_found: 'ไม่พบ', wrong_location: 'ผิดสถานที่', wrong_custodian: 'ผู้ถือครองผิด' };
        return standardEntry({
          row, source: 'Asset Verification', code: value(asset ?? {}, 'asset_code'), title: value(asset ?? {}, 'name'),
          status: resultLabels[result] ?? result, category: value(campaign ?? {}, 'campaign_code'),
          owner: person(directory, row.actual_custodian_employee_id).name,
          created: row.scanned_at,
          warning: result !== 'found', critical: result === 'not_found',
          extraRow: {
            campaignCode: value(campaign ?? {}, 'campaign_code'), campaignName: value(campaign ?? {}, 'name'),
            expectedLocation: value(row, 'expected_location'), actualLocation: value(row, 'actual_location'),
            expectedCustodian: person(directory, row.expected_custodian_employee_id).name,
            actualCustodian: person(directory, row.actual_custodian_employee_id).name,
            note: value(row, 'note'),
          },
        });
      },
    }],
  },
  'security-resilience': {
    key: 'security-resilience', label: 'Security & Resilience', sortOrder: 40,
    description: 'Incident, Vulnerability, Backup และ Recovery ที่กระทบความมั่นคงปลอดภัย',
    sourcePermissions: ['incident.view', 'vulnerability.view', 'backup.view'],
    sources: [
      { permission: 'incident.view', table: 'incidents', dateColumn: 'created_at', sourceLabel: 'Incident', select: 'id,incident_number,title,severity,status,report_date,dpo_notify_deadline,closed_at,created_at,assignee_id,contains_personal_data', map: (row) => standardEntry({ row, source: 'Incident', code: value(row, 'incident_number'), title: value(row, 'title'), status: value(row, 'status'), category: value(row, 'severity'), owner: value(row, 'assignee_id'), due: row.dpo_notify_deadline, created: row.report_date ?? row.created_at, completed: row.closed_at, critical: /สูง|วิกฤต|critical/i.test(value(row, 'severity')) || Boolean(row.contains_personal_data) }) },
      { permission: 'vulnerability.view', table: 'vulnerability_findings', dateColumn: 'created_at', sourceLabel: 'Vulnerability', select: 'id,vulnerability_code,title,severity,status,due_date,detected_at,verified_at,created_at,owner_id,cvss', map: (row) => standardEntry({ row, source: 'Vulnerability', code: value(row, 'vulnerability_code'), title: value(row, 'title'), status: value(row, 'status'), category: `${value(row, 'severity')}${row.cvss === null ? '' : ` · CVSS ${value(row, 'cvss')}`}`, owner: value(row, 'owner_id'), due: row.due_date, created: row.detected_at ?? row.created_at, completed: row.verified_at, critical: /สูง|วิกฤต|critical/i.test(value(row, 'severity')) }) },
      { permission: 'backup.view', table: 'backup_logs', dateColumn: 'created_at', sourceLabel: 'Backup', select: 'id,backup_code,system_name,backup_type,result,backup_date,next_backup_due,created_at,operator_id', map: (row) => standardEntry({ row, source: 'Backup', code: value(row, 'backup_code'), title: value(row, 'system_name'), status: value(row, 'result'), category: value(row, 'backup_type'), owner: value(row, 'operator_id'), due: row.next_backup_due, created: row.backup_date ?? row.created_at, completed: row.backup_date, warning: !/สำเร็จ$/i.test(value(row, 'result')), critical: /ล้มเหลว|fail/i.test(value(row, 'result')) }) },
      { permission: 'backup.view', table: 'recovery_tests', dateColumn: 'created_at', sourceLabel: 'Recovery Test', select: 'id,recovery_code,system_name,result,test_date,next_test_due,created_at,tester_id', map: (row) => standardEntry({ row, source: 'Recovery Test', code: value(row, 'recovery_code'), title: value(row, 'system_name'), status: value(row, 'result'), category: 'Recovery', owner: value(row, 'tester_id'), due: row.next_test_due, created: row.test_date ?? row.created_at, completed: row.test_date, warning: value(row, 'result') !== 'ผ่าน', critical: /ไม่ผ่าน/i.test(value(row, 'result')) }) },
    ],
  },
  'governance-compliance': {
    key: 'governance-compliance', label: 'Governance & Compliance', sortOrder: 50,
    description: 'ความเสี่ยง ข้อกำหนด ข้อค้นพบ Audit และหลักฐานควบคุม',
    sourcePermissions: ['risk.view', 'compliance.view', 'audit_management.view', 'evidence.view'],
    sources: [
      { permission: 'risk.view', table: 'governance_risks', dateColumn: 'created_at', sourceLabel: 'Risk', currentState: true, select: 'id,risk_code,title,category,owner,risk_score,residual_score,due_date,status,identified_date,created_at', map: (row) => standardEntry({ row, source: 'Risk', code: value(row, 'risk_code'), title: value(row, 'title'), status: value(row, 'status'), category: `${value(row, 'category')} · Score ${value(row, 'risk_score')}`, owner: value(row, 'owner'), due: row.due_date, created: row.identified_date ?? row.created_at, critical: numeric(row, 'risk_score') >= 16 }) },
      { permission: 'compliance.view', table: 'compliance_obligations', dateColumn: 'created_at', sourceLabel: 'Compliance', currentState: true, select: 'id,obligation_code,requirement,control_domain,control_owner,due_date,status,applicability_status,created_at', map: (row) => standardEntry({ row, source: 'Compliance', code: value(row, 'obligation_code'), title: value(row, 'requirement'), status: value(row, 'status'), category: value(row, 'control_domain'), owner: value(row, 'control_owner'), due: row.due_date, created: row.created_at }) },
      { permission: 'audit_management.view', table: 'audit_findings', dateColumn: 'created_at', sourceLabel: 'Audit Finding', currentState: true, select: 'id,finding_code,title,finding_type,owner,due_date,status,verified_at,created_at', map: (row) => standardEntry({ row, source: 'Audit Finding', code: value(row, 'finding_code'), title: value(row, 'title'), status: value(row, 'status'), category: value(row, 'finding_type'), owner: value(row, 'owner'), due: row.due_date, created: row.created_at, completed: row.verified_at, critical: /major|วิกฤต|สูง/i.test(value(row, 'finding_type')) }) },
      { permission: 'evidence.view', table: 'governance_evidence_items', dateColumn: 'created_at', sourceLabel: 'Evidence', currentState: true, select: 'id,evidence_code,title,source_module,status,owner,observed_at,expires_at,created_at', map: (row) => standardEntry({ row, source: 'Evidence', code: value(row, 'evidence_code'), title: value(row, 'title'), status: value(row, 'status'), category: value(row, 'source_module'), owner: value(row, 'owner'), due: row.expires_at, created: row.observed_at ?? row.created_at, warning: isOverdue(row.expires_at, false) }) },
    ],
  },
};

export const reportsRoute = new Hono<AppEnv>();
reportsRoute.use('*', requireAuth);
reportsRoute.use('*', requirePermission('report.view'));

async function permissionSet(c: Context<AppEnv>): Promise<{ permissions: Set<string>; error?: string }> {
  const { data, error } = await c.get('supabase').rpc('my_permissions');
  if (error) return { permissions: new Set(), error: error.message };
  return { permissions: new Set((data ?? []).map((row: { permission_key: string }) => row.permission_key)) };
}

function allowedSources(permissions: Set<string>, config: ReportConfig): SourceConfig[] {
  return config.sources.filter((source) => (Array.isArray(source.permission) ? source.permission : [source.permission]).some((key) => permissions.has(key)));
}

/** ทะเบียนพนักงานเต็มองค์กรมีไม่กี่พันแถว ดึงทีเดียวถูกกว่าไล่ .in() ทีละชุดจนความยาว URL แตก */
const DIRECTORY_MAX_ROWS = 5000;

/**
 * ทะเบียนชื่อพนักงานสำหรับคอลัมน์ "ผู้รับผิดชอบ" และ "ผู้ถือครอง"
 *
 * ตาราง employees ถูกล็อก select ไว้ที่ employee.manage เพราะมี PII (email, upn, username_ad)
 * ถ้า embed ตรง ๆ ในรายงาน คนที่มีแค่ asset.view จะได้ค่าว่างทั้งคอลัมน์ ส่วนการยัด uuid ลงไปแทน
 * ก็อ่านไม่รู้เรื่องอยู่ดี จึงอ่านผ่าน admin client แล้วคืนเฉพาะฟิลด์ทะเบียน เหมือนที่
 * GET /api/v1/employees/options ทำ — สิทธิ์ถูกตรวจไปแล้วที่ allowedSources ของแหล่งข้อมูลนั้น
 *
 * ไม่กรอง status active ต่างจาก /options เพราะทะเบียนคุมต้องยังชี้ชื่อคนที่ลาออกไปแล้ว
 * แต่ยังไม่ได้คืนของได้
 */
async function loadDirectory(client: SupabaseClient): Promise<{ directory: Directory; error?: string }> {
  const [employeesResult, profilesResult] = await Promise.all([
    client.from('employees').select('id,employee_code,prefix_th,first_name_th,last_name_th,department_id,department:departments(name_th)').limit(DIRECTORY_MAX_ROWS),
    client.from('profiles').select('id,employee_code,full_name,department_id,department:departments(name_th)').limit(DIRECTORY_MAX_ROWS),
  ]);
  if (employeesResult.error) return { directory: new Map(), error: employeesResult.error.message };
  if (profilesResult.error) return { directory: new Map(), error: profilesResult.error.message };
  const directory: Directory = new Map();
  for (const row of (employeesResult.data ?? []) as unknown as Row[]) {
    directory.set(value(row, 'id'), {
      name: `${value(row, 'prefix_th')}${value(row, 'first_name_th')} ${value(row, 'last_name_th')}`.trim(),
      code: value(row, 'employee_code'),
      department: relatedValue(row, 'department', 'name_th'),
      departmentId: value(row, 'department_id'),
    });
  }
  for (const row of (profilesResult.data ?? []) as unknown as Row[]) {
    directory.set(value(row, 'id'), {
      name: value(row, 'full_name'),
      code: value(row, 'employee_code'),
      department: relatedValue(row, 'department', 'name_th'),
      departmentId: value(row, 'department_id'),
    });
  }
  return { directory };
}

async function availableDefinitions(client: SupabaseClient, permissions: Set<string>): Promise<{ definitions: ReportDefinition[]; error?: string }> {
  const allowed = Object.values(REPORTS).filter((config) => allowedSources(permissions, config).length > 0);
  const { data, error } = await client.from('report_definitions').select('key,label,description,required_permissions,sort_order').eq('status', 'active').order('sort_order');
  if (error) return { definitions: [], error: error.message };
  const database = new Map((data ?? []).map((row) => [String(row.key), row]));
  return {
    definitions: allowed.map((config) => {
      const row = database.get(config.key);
      return { key: config.key, label: row ? String(row.label) : config.label, description: row ? String(row.description) : config.description, sourcePermissions: config.sourcePermissions, sortOrder: row ? Number(row.sort_order) : config.sortOrder };
    }).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

async function loadEntries(
  client: SupabaseClient,
  permissions: Set<string>,
  config: ReportConfig,
  filters: ReportFilters,
  directoryClient: SupabaseClient = client,
): Promise<{ entries: ReportEntry[]; freshness: ReportFreshness[]; error?: string }> {
  const sources = allowedSources(permissions, config);
  if (!sources.length) return { entries: [], freshness: [], error: 'ไม่มีสิทธิ์เข้าถึงแหล่งข้อมูลของรายงานนี้' };
  const since = new Date(Date.now() - filters.rangeDays * 86_400_000).toISOString();
  const directoryPromise: Promise<{ directory: Directory; error?: string }> = loadDirectory(directoryClient);
  const results = await Promise.all(sources.map(async (source) => {
    let query = client.from(source.table).select(source.select).order(source.dateColumn, { ascending: false }).limit(2000);
    if (filters.from && !source.currentState) query = query.gte(source.dateColumn, `${filters.from}T00:00:00.000Z`);
    else if (filters.rangeDays > 0 && !source.currentState) query = query.gte(source.dateColumn, since);
    if (filters.to && !source.currentState) query = query.lt(source.dateColumn, `${filters.to}T00:00:00.000Z`);
    const { data, error } = await query;
    return { source, data: (data ?? []) as unknown as Row[], error };
  }));
  const error = results.find((result) => result.error)?.error;
  if (error) return { entries: [], freshness: [], error: error.message };
  const { directory, error: directoryError } = await directoryPromise;
  if (directoryError) return { entries: [], freshness: [], error: directoryError };
  const freshnessResults = await Promise.all(sources.map(async (source) => {
    const latest = await client.from(source.table).select('updated_at').order('updated_at', { ascending: false }).limit(1);
    return { source: source.sourceLabel, lastUpdatedAt: latest.error ? null : (latest.data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? null };
  }));
  const now = Date.now();
  const freshness = freshnessResults.map((item) => ({
    ...item,
    status: item.lastUpdatedAt === null ? 'unknown' as const : (now - new Date(item.lastUpdatedAt).getTime() > 86_400_000 ? 'stale' as const : 'fresh' as const),
  }));
  const entries = results.flatMap((result) => result.data.map((row) => {
    const entry = result.source.map(row, directory);
    const owner = entry.row.ownerId ? person(directory, entry.row.ownerId) : null;
    if (owner && owner.name) {
      if (entry.row.owner === '—' || entry.row.owner === entry.row.ownerId) entry.row.owner = owner.name;
      if (entry.row.department === '—') entry.row.department = owner.department || '—';
      if (!entry.row.departmentId && owner.departmentId) entry.row.departmentId = owner.departmentId;
    }
    return entry;
  })).filter((entry) => {
    if (filters.departmentId && String(entry.row.departmentId ?? '') !== filters.departmentId) return false;
    if (filters.ownerId && String(entry.row.ownerId ?? '') !== filters.ownerId) return false;
    return true;
  });
  return { entries, freshness };
}

function countBy(entries: ReportEntry[], key: string): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const label = String(entry.row[key] ?? '—');
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function trend(entries: ReportEntry[]) {
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(); date.setUTCDate(1); date.setUTCHours(0, 0, 0, 0); date.setUTCMonth(date.getUTCMonth() - (5 - index));
    return { key: date.toISOString().slice(0, 7), label: new Intl.DateTimeFormat('th-TH', { month: 'short' }).format(date), primary: 0, secondary: 0 };
  });
  const map = new Map(months.map((month) => [month.key, month]));
  for (const entry of entries) {
    const created = map.get(entry.createdAt.slice(0, 7)); if (created) created.primary += 1;
    if (entry.completedAt) { const completed = map.get(entry.completedAt.slice(0, 7)); if (completed) completed.secondary += 1; }
  }
  return months.map(({ label, primary, secondary }) => ({ label, primary, secondary }));
}

function metric(label: string, value: string | number, tone: Tone, note?: string) { return { label, value, tone, note }; }

const CSAT_STOP_WORDS = new Set(['การ', 'และ', 'ที่', 'ได้', 'ให้', 'ของ', 'มาก', 'ครับ', 'ค่ะ', 'แต่', 'จาก', 'กับ', 'เป็น', 'ไม่', 'มี', 'แล้ว']);

export function buildCsatAnalytics(entries: CsatEntryInput[], now = new Date()) {
  const rated = entries.filter((entry) => entry.rating !== undefined && entry.rating >= 1 && entry.rating <= 5);
  const responseCount = rated.length;
  const average = responseCount ? Number((rated.reduce((sum, entry) => sum + (entry.rating ?? 0), 0) / responseCount).toFixed(2)) : null;
  const distribution = [5, 4, 3, 2, 1].map((score) => {
    const count = rated.filter((entry) => entry.rating === score).length;
    return { score, count, percentage: responseCount ? Number(((count / responseCount) * 100).toFixed(1)) : 0 };
  });

  const currentWeek = new Date(now);
  currentWeek.setUTCHours(0, 0, 0, 0);
  const weekday = currentWeek.getUTCDay() || 7;
  currentWeek.setUTCDate(currentWeek.getUTCDate() - weekday + 1);
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const start = new Date(currentWeek);
    start.setUTCDate(start.getUTCDate() - (11 - index) * 7);
    return { key: start.toISOString().slice(0, 10), start, label: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(start), total: 0, responses: 0 };
  });
  const weekMap = new Map(weeks.map((week) => [week.key, week]));
  for (const entry of rated) {
    const submitted = new Date(entry.feedbackAt ?? entry.createdAt);
    if (Number.isNaN(submitted.getTime())) continue;
    submitted.setUTCHours(0, 0, 0, 0);
    const submittedWeekday = submitted.getUTCDay() || 7;
    submitted.setUTCDate(submitted.getUTCDate() - submittedWeekday + 1);
    const week = weekMap.get(submitted.toISOString().slice(0, 10));
    if (week) { week.total += entry.rating ?? 0; week.responses += 1; }
  }
  const weeklyTrend = weeks.map((week) => ({ label: week.label, average: week.responses ? Number((week.total / week.responses).toFixed(2)) : null, responses: week.responses }));

  function groupedScores(key: 'category' | 'owner') {
    const groups = new Map<string, { total: number; responses: number }>();
    for (const entry of rated) {
      const label = entry[key]?.trim();
      if (!label || label === '—') continue;
      const current = groups.get(label) ?? { total: 0, responses: 0 };
      current.total += entry.rating ?? 0;
      current.responses += 1;
      groups.set(label, current);
    }
    return [...groups.entries()]
      .map(([label, score]) => ({ label, average: Number((score.total / score.responses).toFixed(2)), responses: score.responses }))
      .sort((a, b) => b.average - a.average || b.responses - a.responses);
  }

  const mentionCounts = new Map<string, number>();
  for (const entry of rated) {
    for (const word of (entry.feedback ?? '').toLocaleLowerCase('th').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').split(/\s+/)) {
      if (word.length < 3 || CSAT_STOP_WORDS.has(word)) continue;
      mentionCounts.set(word, (mentionCounts.get(word) ?? 0) + 1);
    }
  }
  const mentions = [...mentionCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'th')).slice(0, 10);
  const followUps = rated
    .filter((entry) => (entry.rating ?? 5) <= 3)
    .sort((a, b) => new Date(b.feedbackAt ?? b.createdAt).getTime() - new Date(a.feedbackAt ?? a.createdAt).getTime())
    .map((entry) => ({ id: entry.id, code: entry.code, title: entry.title, rating: entry.rating ?? 0, feedback: entry.feedback ?? '', submittedAt: entry.feedbackAt ?? entry.createdAt, owner: entry.owner }));

  return {
    average,
    responseCount,
    distribution,
    weeklyTrend,
    categories: groupedScores('category'),
    technicians: groupedScores('owner').slice(0, 5),
    followUpCount: followUps.length,
    followUps: followUps.slice(0, 20),
    mentions,
  };
}

export function buildDataset(
  config: ReportConfig,
  definition: ReportDefinition,
  loaded: ReportEntry[],
  rangeDays: number,
  meta: { filters?: ReportFilters; freshness?: ReportFreshness[]; comparison?: ReportComparison[] } = {},
) {
  // ทะเบียนคุมต้องอ่านเป็นราย "คน" ของทุกชิ้นที่คนเดียวกันถืออยู่ต้องเรียงติดกัน ไม่ใช่ไล่ตามวันที่บันทึก
  const entries = config.key === 'asset-custody'
    ? [...loaded].sort((a, b) => String(a.row.owner).localeCompare(String(b.row.owner), 'th')
      || String(a.row.employeeId).localeCompare(String(b.row.employeeId))
      || String(a.row.category).localeCompare(String(b.row.category), 'th'))
    : loaded;
  const open = entries.filter((entry) => !entry.terminal).length;
  const completed = entries.filter((entry) => entry.terminal).length;
  const overdue = entries.filter((entry) => entry.overdue).length;
  const warning = entries.filter((entry) => entry.warning).length;
  const critical = entries.filter((entry) => entry.critical && !entry.terminal).length;
  const paused = entries.filter((entry) => entry.paused).length;
  const amount = entries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const ratings = entries.flatMap((entry) => entry.rating === undefined ? [] : [entry.rating]);
  let metrics = [metric('รายการทั้งหมด', entries.length, 'primary'), metric('กำลังดำเนินการ', open, open ? 'amber' : 'gray'), metric('เกินกำหนด', overdue, overdue ? 'danger' : 'teal'), metric('เสร็จสิ้น', completed, 'teal')];
  if (config.key === 'service-desk') metrics = [metric('Ticket ทั้งหมด', entries.length, 'primary'), metric('งานเปิด', open, open ? 'amber' : 'gray'), metric('พัก SLA', paused, paused ? 'amber' : 'teal'), metric('เกิน SLA / กำหนด', overdue, overdue ? 'danger' : 'teal'), metric('CSAT เฉลี่ย', ratings.length ? `${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)}/5` : '—', 'teal', `${ratings.length} คำตอบ`)];
  if (config.key === 'assets-operations') metrics = [metric('รายการที่ดูแล', entries.length, 'primary'), metric('มูลค่าที่บันทึก', amount.toLocaleString('th-TH', { maximumFractionDigits: 2 }), 'teal', 'บาท'), metric('ต้องติดตาม', warning + overdue, warning + overdue ? 'amber' : 'teal'), metric('เสร็จ/ไม่ใช้งาน', completed, 'gray')];
  if (config.key === 'asset-custody') {
    const held = entries.filter((entry) => entry.row.status === 'ครอบครอง').length;
    const holders = new Set(entries.filter((entry) => CUSTODY_HOLDING_STATUSES.includes(String(entry.row.status))).map((entry) => entry.row.employeeId)).size;
    metrics = [metric('รายการที่ถือครองอยู่', held, 'primary'), metric('พนักงานที่ถือครอง', holders, 'teal', 'คน'), metric('อยู่ระหว่างส่งซ่อม', warning, warning ? 'amber' : 'gray'), metric('แจ้งสูญหาย', critical, critical ? 'danger' : 'teal')];
  }
  if (config.key === 'security-resilience') metrics = [metric('เหตุการณ์/การตรวจ', entries.length, 'primary'), metric('ยังเปิดอยู่', open, open ? 'amber' : 'teal'), metric('ระดับสูง/วิกฤต', critical, critical ? 'danger' : 'teal'), metric('เกินกำหนด', overdue, overdue ? 'danger' : 'teal')];
  if (config.key === 'governance-compliance') metrics = [metric('รายการกำกับดูแล', entries.length, 'primary'), metric('ยังเปิดอยู่', open, open ? 'amber' : 'teal'), metric('ความเสี่ยง/ข้อค้นพบสูง', critical, critical ? 'danger' : 'teal'), metric('เกินกำหนด/หมดอายุ', overdue + warning, overdue + warning ? 'danger' : 'teal')];
  const alerts: string[] = [];
  if (config.key === 'asset-custody') {
    // ทะเบียนคุมไม่มีวันครบกำหนด คำเตือนกลางเรื่อง "เกินกำหนด/ระดับวิกฤต" จึงไม่ตรงกับสิ่งที่ต้องตามจริง
    if (critical) alerts.push(`มี ${critical} รายการที่แจ้งสูญหายและยังไม่ได้ปิดเรื่อง`);
    if (warning) alerts.push(`มี ${warning} รายการอยู่ระหว่างส่งซ่อม ยังไม่กลับไปถึงผู้ถือครอง`);
  } else {
    if (overdue) alerts.push(`มี ${overdue} รายการเกินกำหนดและยังไม่ปิด`);
    if (critical) alerts.push(`มี ${critical} รายการระดับสูงหรือวิกฤตที่ยังเปิดอยู่`);
    if (warning) alerts.push(`มี ${warning} รายการที่ถึงเกณฑ์เตือน ต้องตรวจสอบรายละเอียด`);
  }
  const columns = config.columns ? [...config.columns] : [
    { key: 'source', label: 'แหล่งข้อมูล' }, { key: 'code', label: 'รหัส' }, { key: 'title', label: 'รายการ' },
    { key: 'status', label: 'สถานะ' }, { key: 'category', label: 'ประเภท/ระดับ' }, { key: 'owner', label: 'ผู้รับผิดชอบ' },
    { key: 'dueDate', label: 'ครบกำหนด' }, { key: 'recordDate', label: 'วันที่บันทึก' },
  ];
  if (config.key === 'service-desk') columns.push({ key: 'slaState', label: 'สถานะ SLA' }, { key: 'rating', label: 'CSAT' }, { key: 'feedback', label: 'ความคิดเห็น' });
  const csatEntries: CsatEntryInput[] = entries.map((entry) => ({
    id: String(entry.row.id ?? ''), code: String(entry.row.code ?? ''), title: String(entry.row.title ?? ''),
    category: String(entry.row.category ?? '—'), owner: String(entry.row.owner ?? '—'), rating: entry.rating,
    feedback: entry.feedback, feedbackAt: entry.feedbackAt, createdAt: entry.createdAt,
  }));
  return {
    definition, metrics, alerts,
    summary: { total: entries.length, open, overdue, critical },
    breakdowns: config.key === 'asset-custody'
      ? [{ label: 'แยกตามหน่วยงาน', items: countBy(entries, 'department') }, { label: 'แยกตามประเภททรัพย์สิน', items: countBy(entries, 'category') }]
      : [{ label: 'แยกตามแหล่งข้อมูล', items: countBy(entries, 'source') }, { label: 'แยกตามสถานะ', items: countBy(entries, 'status') }],
    trend: trend(entries),
    trendLabels: config.key === 'asset-custody' ? { primary: 'รับมอบ', secondary: 'คืน' } : { primary: 'สร้าง', secondary: 'เสร็จสิ้น' },
    columns,
    rows: entries.map((entry) => entry.row), totalRows: entries.length, rangeDays, generatedAt: new Date().toISOString(),
    ...meta,
    csat: config.key === 'service-desk' ? buildCsatAnalytics(csatEntries) : undefined,
  };
}

/** re-export ตัวกลางเพื่อให้จุดเรียกเดิมยังใช้ path นี้ได้ */
export { csvCell };

export function reportCsv(dataset: ReturnType<typeof buildDataset>): string {
  const header = dataset.columns.map((column) => csvCell(column.label)).join(',');
  const lines = dataset.rows.map((row) => dataset.columns.map((column) => csvCell(row[column.key])).join(','));
  return [header, ...lines].join('\r\n');
}

function executivePackCsv(pack: ExecutivePack): string {
  const lines = [
    ['ประเภท', 'รายการ', 'ค่า', 'หมายเหตุ'],
    ...pack.metrics.map((item) => ['Executive KPI', item.label, item.value, item.note ?? '']),
    ...pack.sections.flatMap((section) => [
      ['Report Section', section.label, section.totalRows, ''],
      ...section.metrics.map((item) => [section.label, item.label, item.value, item.note ?? '']),
    ]),
  ];
  return lines.map((line) => line.map((value) => csvCell(value)).join(',')).join('\r\n');
}

async function createScheduledArtifact(
  env: AppEnv['Bindings'],
  reportKey: string,
  dataset: unknown,
  format: 'CSV' | 'PDF' | 'PRINT',
  saveToDrive: boolean,
  now: Date,
): Promise<ScheduledArtifact> {
  if (!saveToDrive || format === 'PRINT') return { name: null, driveId: null, driveUrl: null, error: null };
  const stamp = now.toISOString().slice(0, 10);
  const baseName = safeDriveName(`${reportKey}-${stamp}`, 'scheduled-report');
  if (format === 'CSV') {
    const csv = reportKey === 'executive-pack'
      ? executivePackCsv(dataset as ExecutivePack)
      : reportCsv(dataset as ReturnType<typeof buildDataset>);
    const result = await uploadCsvAsGoogleSheet(env, { name: `${baseName}.csv`, csv }, fetch, now);
    return result.ok
      ? { name: result.file.name, driveId: result.file.id, driveUrl: result.file.webViewLink, error: null }
      : { name: null, driveId: null, driveUrl: null, error: result.message };
  }
  if (!env.MYBROWSER) return { name: null, driveId: null, driveUrl: null, error: 'ยังไม่ได้ตั้งค่า Browser Rendering สำหรับ Scheduled PDF' };
  const html = reportKey === 'executive-pack'
    ? renderExecutivePackHtml(dataset as ExecutivePack)
    : renderReportHtml(dataset as ReturnType<typeof buildDataset>);
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderHtmlToPdf(env.MYBROWSER, html);
  } catch (error) {
    return { name: null, driveId: null, driveUrl: null, error: error instanceof Error ? error.message : 'สร้าง Scheduled PDF ไม่สำเร็จ' };
  }
  const result = await uploadToDrive(env, {
    name: safeDriveName(`${baseName}.pdf`, 'scheduled-report.pdf'),
    contentType: 'application/pdf',
    content: pdfBytes,
    subFolder: buddhistYearFolder(now),
  });
  return result.ok
    ? { name: result.file.name, driveId: result.file.id, driveUrl: result.file.webViewLink, error: null }
    : { name: null, driveId: null, driveUrl: null, error: result.message };
}

function numericMetricValue(value: string | number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function compareDatasets(current: ReturnType<typeof buildDataset>, previous: ReturnType<typeof buildDataset>): ReportComparison[] {
  return current.metrics.map((metric) => {
    const currentValue = numericMetricValue(metric.value);
    const previousValue = numericMetricValue(previous.metrics.find((item) => item.label === metric.label)?.value ?? '');
    const delta = currentValue === null || previousValue === null ? null : currentValue - previousValue;
    return {
      label: metric.label,
      current: currentValue,
      previous: previousValue,
      delta,
      deltaPercentage: delta === null || previousValue === null || previousValue === 0 ? null : Number(((delta / Math.abs(previousValue)) * 100).toFixed(1)),
    };
  });
}

function previousPeriodFilters(filters: ReportFilters): ReportFilters {
  if (filters.from && filters.to) {
    const from = new Date(`${filters.from}T00:00:00.000Z`);
    const to = new Date(`${filters.to}T00:00:00.000Z`);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
    return { ...filters, from: new Date(from.getTime() - days * 86_400_000).toISOString().slice(0, 10), to: filters.from };
  }
  if (filters.rangeDays <= 0) return { ...filters, comparePrevious: false };
  const currentEnd = new Date();
  const currentStart = new Date(currentEnd.getTime() - filters.rangeDays * 86_400_000);
  return { ...filters, from: new Date(currentStart.getTime() - filters.rangeDays * 86_400_000).toISOString().slice(0, 10), to: currentStart.toISOString().slice(0, 10) };
}

async function datasetFor(c: Context<AppEnv>, key: string, filters: ReportFilters) {
  const config = REPORTS[key as ReportKey];
  if (!config) return { status: 404 as const, error: 'ไม่พบรายงานที่ระบุ' };
  const permissionResult = await permissionSet(c);
  if (permissionResult.error) return { status: 400 as const, error: permissionResult.error };
  const definitions = await availableDefinitions(c.get('supabase'), permissionResult.permissions);
  if (definitions.error) return { status: 400 as const, error: definitions.error };
  const definition = definitions.definitions.find((item) => item.key === config.key);
  if (!definition) return { status: 403 as const, error: 'ไม่มีสิทธิ์เข้าถึงแหล่งข้อมูลของรายงานนี้' };
  const loaded = await loadEntries(c.get('supabase'), permissionResult.permissions, config, filters, createAdminClient(c.env));
  if (loaded.error) return { status: 400 as const, error: loaded.error };
  const dataset = buildDataset(config, definition, loaded.entries, filters.rangeDays, { filters, freshness: loaded.freshness });
  if (filters.comparePrevious !== false && (filters.rangeDays > 0 || Boolean(filters.from && filters.to))) {
    const previousFilters = previousPeriodFilters(filters);
    const previousLoaded = await loadEntries(c.get('supabase'), permissionResult.permissions, config, previousFilters, createAdminClient(c.env));
    if (!previousLoaded.error) {
      const previous = buildDataset(config, definition, previousLoaded.entries, previousFilters.rangeDays);
      dataset.comparison = compareDatasets(dataset, previous);
    }
  }
  return { status: 200 as const, dataset };
}

function monthBounds(month: string): { start: string; end: string; previousStart: string; previousEnd: string; days: number } {
  const [year, monthNumber] = month.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, monthNumber - 1, 1));
  const endDate = new Date(Date.UTC(year, monthNumber, 1));
  const previousStart = new Date(Date.UTC(year, monthNumber - 2, 1));
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
    previousStart: previousStart.toISOString().slice(0, 10),
    previousEnd: startDate.toISOString().slice(0, 10),
    days: Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000),
  };
}

export async function buildExecutivePack(
  client: SupabaseClient,
  permissions: Set<string>,
  month: string,
  directoryClient: SupabaseClient = client,
): Promise<ExecutivePack> {
  const bounds = monthBounds(month);
  const definitions = await availableDefinitions(client, permissions);
  if (definitions.error) throw new Error(definitions.error);
  const sections: ExecutivePack['sections'] = [];
  const freshnessMap = new Map<string, ReportFreshness>();
  let total = 0;
  let open = 0;
  let overdue = 0;
  let critical = 0;
  let previousTotal = 0;
  let previousOpen = 0;
  let previousOverdue = 0;
  let previousCritical = 0;

  for (const definition of definitions.definitions) {
    const config = REPORTS[definition.key];
    const current = await loadEntries(client, permissions, config, { rangeDays: bounds.days, from: bounds.start, to: bounds.end, comparePrevious: false }, directoryClient);
    if (current.error) continue;
    const previous = await loadEntries(client, permissions, config, { rangeDays: bounds.days, from: bounds.previousStart, to: bounds.previousEnd, comparePrevious: false }, directoryClient);
    const dataset = buildDataset(config, definition, current.entries, bounds.days, { filters: { rangeDays: bounds.days, from: bounds.start, to: bounds.end, comparePrevious: false }, freshness: current.freshness });
    for (const item of current.freshness) freshnessMap.set(item.source, item);
    sections.push({ key: definition.key, label: definition.label, totalRows: dataset.totalRows, metrics: dataset.metrics, alerts: dataset.alerts });
    total += dataset.summary.total;
    open += dataset.summary.open;
    overdue += dataset.summary.overdue;
    critical += dataset.summary.critical;
    if (!previous.error) {
      const previousDataset = buildDataset(config, definition, previous.entries, bounds.days);
      previousTotal += previousDataset.summary.total;
      previousOpen += previousDataset.summary.open;
      previousOverdue += previousDataset.summary.overdue;
      previousCritical += previousDataset.summary.critical;
    }
  }

  const thaiMonth = new Intl.DateTimeFormat('th-TH', { month: 'long', timeZone: 'Asia/Bangkok' }).format(new Date(`${bounds.start}T12:00:00.000Z`));
  const buddhistYear = Number(month.slice(0, 4)) + 543;
  const comparison: ReportComparison[] = [
    { label: 'รายการรวม', current: total, previous: previousTotal, delta: total - previousTotal, deltaPercentage: previousTotal ? Number((((total - previousTotal) / Math.abs(previousTotal)) * 100).toFixed(1)) : null },
    { label: 'รายการคงค้าง', current: open, previous: previousOpen, delta: open - previousOpen, deltaPercentage: previousOpen ? Number((((open - previousOpen) / Math.abs(previousOpen)) * 100).toFixed(1)) : null },
    { label: 'เกินกำหนด', current: overdue, previous: previousOverdue, delta: overdue - previousOverdue, deltaPercentage: previousOverdue ? Number((((overdue - previousOverdue) / Math.abs(previousOverdue)) * 100).toFixed(1)) : null },
    { label: 'ความเสี่ยงสูง/วิกฤต', current: critical, previous: previousCritical, delta: critical - previousCritical, deltaPercentage: previousCritical ? Number((((critical - previousCritical) / Math.abs(previousCritical)) * 100).toFixed(1)) : null },
  ];
  const { data: kpiRows, error: kpiError } = await client.from('report_kpi_definitions').select('key,label,description,formula,unit,target,direction').eq('status', 'active').order('sort_order');
  if (kpiError) throw new Error(kpiError.message);
  return {
    reportKey: 'executive-pack',
    title: `รายงานผลการดำเนินงานด้านเทคโนโลยีสารสนเทศ ประจำเดือน ${thaiMonth} ${buddhistYear}`,
    month,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    generatedAt: new Date().toISOString(),
    metrics: [
      metric('รายการรวม', total, 'primary', 'ทุกรายงานที่ผู้ใช้เข้าถึงได้'),
      metric('รายการคงค้าง', open, open ? 'amber' : 'teal'),
      metric('เกินกำหนด', overdue, overdue ? 'danger' : 'teal'),
      metric('ความเสี่ยงสูง/วิกฤต', critical, critical ? 'danger' : 'teal'),
    ],
    comparison,
    freshness: [...freshnessMap.values()],
    sections,
    kpis: ((kpiRows ?? []) as unknown as ExecutivePack['kpis']),
  };
}

export async function generateScheduledSnapshot(
  env: AppEnv['Bindings'],
  schedule: { report_key: string; filters?: unknown; created_by?: string | null; format?: 'CSV' | 'PDF' | 'PRINT'; save_to_drive?: boolean },
  now = new Date(),
): Promise<{ id: string; title: string; artifact: ScheduledArtifact }> {
  const admin = createAdminClient(env);
  const permissions = new Set(Object.values(REPORTS).flatMap((config) => config.sourcePermissions));
  const stored = schedule.filters && typeof schedule.filters === 'object' ? schedule.filters as Partial<ReportFilters> : {};
  const filters: ReportFilters = {
    rangeDays: Number.isInteger(stored.rangeDays) ? Number(stored.rangeDays) : 30,
    departmentId: stored.departmentId,
    ownerId: stored.ownerId,
    from: stored.from,
    to: stored.to,
    comparePrevious: stored.comparePrevious ?? true,
  };
  let title: string;
  let dataset: unknown;
  let periodStart: string | null = filters.from ?? null;
  let periodEnd: string | null = filters.to ?? null;
  let snapshotKind: 'scheduled' | 'executive_pack' = 'scheduled';
  if (schedule.report_key === 'executive-pack') {
    const month = now.toISOString().slice(0, 7);
    const pack = await buildExecutivePack(admin, permissions, month, admin);
    title = pack.title;
    dataset = pack;
    periodStart = pack.periodStart;
    periodEnd = pack.periodEnd;
    snapshotKind = 'executive_pack';
  } else {
    const config = REPORTS[schedule.report_key as ReportKey];
    if (!config) throw new Error('ไม่พบรายงานที่กำหนดเวลาไว้');
    const definitions = await availableDefinitions(admin, permissions);
    const definition = definitions.definitions.find((item) => item.key === config.key);
    if (!definition) throw new Error('ไม่พบ definition ของรายงานที่กำหนดเวลาไว้');
    const loaded = await loadEntries(admin, permissions, config, filters, admin);
    if (loaded.error) throw new Error(loaded.error);
    dataset = buildDataset(config, definition, loaded.entries, filters.rangeDays, { filters, freshness: loaded.freshness });
    title = `${definition.label} Snapshot`;
  }
  const { data, error } = await admin.from('report_snapshots').insert({ report_key: schedule.report_key, snapshot_kind: snapshotKind, title, period_start: periodStart, period_end: periodEnd, filters, dataset, generated_at: now.toISOString(), created_by: schedule.created_by ?? null }).select('id').single();
  if (error) throw new Error(error.message);
  const artifact = await createScheduledArtifact(env, schedule.report_key, dataset, schedule.format ?? 'PDF', schedule.save_to_drive ?? false, now);
  return { id: String(data.id), title, artifact };
}

reportsRoute.get('/', zValidator('query', reportRangeQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const { rangeDays } = c.req.valid('query');
  const permissionResult = await permissionSet(c);
  if (permissionResult.error) return c.json(fail(requestId, 'REPORT_PERMISSIONS_LOAD_FAILED', permissionResult.error), 400);
  const result = await availableDefinitions(c.get('supabase'), permissionResult.permissions);
  if (result.error) return c.json(fail(requestId, 'REPORT_DEFINITIONS_LOAD_FAILED', result.error), 400);
  return c.json(ok(requestId, { definitions: result.definitions, metrics: [metric('รายงานที่เข้าถึงได้', result.definitions.length, 'primary')], alerts: [], rangeDays, generatedAt: new Date().toISOString() }));
});

reportsRoute.get('/options', async (c) => {
  const requestId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const [directoryResult, departmentsResult] = await Promise.all([
    loadDirectory(admin),
    admin.from('departments').select('id,name_th').eq('status', 'active').order('name_th'),
  ]);
  if (directoryResult.error) return c.json(fail(requestId, 'REPORT_OPTIONS_LOAD_FAILED', directoryResult.error), 400);
  if (departmentsResult.error) return c.json(fail(requestId, 'REPORT_OPTIONS_LOAD_FAILED', departmentsResult.error.message), 400);
  const owners = [...directoryResult.directory.entries()]
    .map(([id, person]) => ({ id, label: person.name || person.code || id, departmentId: person.departmentId || null }))
    .filter((item) => item.label)
    .sort((a, b) => a.label.localeCompare(b.label, 'th'));
  return c.json(ok(requestId, {
    departments: (departmentsResult.data ?? []).map((row) => ({ id: String(row.id), label: String(row.name_th) })),
    owners,
  }));
});

reportsRoute.get('/saved-filters', zValidator('query', reportSavedFilterQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const { reportKey } = c.req.valid('query');
  let query = c.get('supabase').from('report_saved_filters').select('id,report_key,name,filters,is_shared,created_at,updated_at').order('updated_at', { ascending: false });
  if (reportKey) query = query.eq('report_key', reportKey);
  const { data, error } = await query;
  if (error) return c.json(fail(requestId, 'REPORT_SAVED_FILTERS_LOAD_FAILED', error.message), 400);
  return c.json(ok(requestId, (data ?? []).map((row) => ({ id: row.id, reportKey: row.report_key, name: row.name, filters: row.filters, isShared: row.is_shared, createdAt: row.created_at, updatedAt: row.updated_at }))));
});

reportsRoute.post('/saved-filters', zValidator('json', reportSavedFilterSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const body = c.req.valid('json');
  if (body.reportKey !== 'executive-pack' && !REPORTS[body.reportKey as ReportKey]) return c.json(fail(requestId, 'REPORT_NOT_FOUND', 'ไม่พบรายงานที่ระบุ'), 404);
  const { data, error } = await c.get('supabase').from('report_saved_filters').insert({ report_key: body.reportKey, name: body.name, filters: body.filters, is_shared: body.isShared, owner_id: c.get('userId') }).select('id,report_key,name,filters,is_shared,created_at,updated_at').single();
  if (error) return c.json(fail(requestId, 'REPORT_SAVED_FILTER_CREATE_FAILED', error.message), 400);
  return c.json(ok(requestId, { id: data.id, reportKey: data.report_key, name: data.name, filters: data.filters, isShared: data.is_shared, createdAt: data.created_at, updatedAt: data.updated_at }), 201);
});

reportsRoute.delete('/saved-filters/:id', async (c) => {
  const requestId = c.get('requestId');
  const { error } = await c.get('supabase').from('report_saved_filters').delete().eq('id', c.req.param('id')).eq('owner_id', c.get('userId'));
  if (error) return c.json(fail(requestId, 'REPORT_SAVED_FILTER_DELETE_FAILED', error.message), 400);
  return c.json(ok(requestId, { deleted: true }));
});

function scheduleDto(row: Row) {
  return {
    id: String(row.id), reportKey: String(row.report_key), name: String(row.name), frequency: String(row.frequency),
    dayOfWeek: row.day_of_week === null ? null : Number(row.day_of_week), dayOfMonth: row.day_of_month === null ? null : Number(row.day_of_month),
    runHour: Number(row.run_hour), timezone: String(row.timezone), format: String(row.format), saveToDrive: Boolean(row.save_to_drive),
    filters: row.filters ?? {}, enabled: Boolean(row.enabled), nextRunAt: String(row.next_run_at), lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
  };
}

function zonedParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}

function zonedWallToUtc(wall: Date, timeZone: string): Date {
  let guess = wall.getTime();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const actualWall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += wall.getTime() - actualWall;
  }
  return new Date(guess);
}

export function nextScheduleAt(schedule: { frequency: 'weekly' | 'monthly'; dayOfWeek?: number; dayOfMonth?: number; runHour: number; timezone?: string }, from = new Date()): string {
  let timeZone = schedule.timezone ?? 'Asia/Bangkok';
  try { zonedParts(from, timeZone); } catch { timeZone = 'UTC'; }
  const local = zonedParts(from, timeZone);
  const candidate = new Date(Date.UTC(local.year, local.month - 1, local.day, schedule.runHour, 0, 0));
  if (schedule.frequency === 'weekly') {
    const localWeekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const target = schedule.dayOfWeek ?? 1;
    const delta = (target - localWeekday + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + delta);
    if (delta === 0 && zonedWallToUtc(candidate, timeZone) <= from) candidate.setUTCDate(candidate.getUTCDate() + 7);
  } else {
    const target = Math.min(schedule.dayOfMonth ?? 1, 28);
    candidate.setUTCDate(target);
    if (zonedWallToUtc(candidate, timeZone) <= from) candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }
  return zonedWallToUtc(candidate, timeZone).toISOString();
}

reportsRoute.get('/schedules', async (c) => {
  const requestId = c.get('requestId');
  const { data, error } = await c.get('supabase').from('report_schedules').select('id,report_key,name,frequency,day_of_week,day_of_month,run_hour,timezone,format,save_to_drive,filters,enabled,next_run_at,last_run_at').order('next_run_at');
  if (error) return c.json(fail(requestId, 'REPORT_SCHEDULES_LOAD_FAILED', error.message), 400);
  return c.json(ok(requestId, (data ?? []).map((row) => scheduleDto(row as unknown as Row))));
});

reportsRoute.post('/schedules', requirePermission('report.schedule'), zValidator('json', reportScheduleSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const body = c.req.valid('json');
  if (body.reportKey !== 'executive-pack' && !REPORTS[body.reportKey as ReportKey]) return c.json(fail(requestId, 'REPORT_NOT_FOUND', 'ไม่พบรายงานที่ระบุ'), 404);
  const nextRunAt = nextScheduleAt(body);
  const { data, error } = await c.get('supabase').from('report_schedules').insert({
    report_key: body.reportKey, name: body.name, frequency: body.frequency, day_of_week: body.dayOfWeek ?? null, day_of_month: body.dayOfMonth ?? null,
    run_hour: body.runHour, timezone: body.timezone, format: body.format, save_to_drive: body.saveToDrive, filters: body.filters, enabled: body.enabled,
    next_run_at: nextRunAt, created_by: c.get('userId'), updated_by: c.get('userId'),
  }).select('id,report_key,name,frequency,day_of_week,day_of_month,run_hour,timezone,format,save_to_drive,filters,enabled,next_run_at,last_run_at').single();
  if (error) return c.json(fail(requestId, 'REPORT_SCHEDULE_CREATE_FAILED', error.message), 400);
  return c.json(ok(requestId, scheduleDto(data as unknown as Row)), 201);
});

reportsRoute.patch('/schedules/:id', requirePermission('report.schedule'), zValidator('json', reportSchedulePatchSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const { data: existing, error: loadError } = await c.get('supabase').from('report_schedules').select('*').eq('id', c.req.param('id')).eq('created_by', c.get('userId')).maybeSingle();
  if (loadError) return c.json(fail(requestId, 'REPORT_SCHEDULE_LOAD_FAILED', loadError.message), 400);
  if (!existing) return c.json(fail(requestId, 'REPORT_SCHEDULE_NOT_FOUND', 'ไม่พบกำหนดการรายงาน'), 404);
  const body = c.req.valid('json');
  const merged = {
    reportKey: body.reportKey ?? existing.report_key, name: body.name ?? existing.name, frequency: body.frequency ?? existing.frequency,
    dayOfWeek: body.dayOfWeek ?? existing.day_of_week ?? undefined, dayOfMonth: body.dayOfMonth ?? existing.day_of_month ?? undefined,
    runHour: body.runHour ?? existing.run_hour, timezone: body.timezone ?? existing.timezone, format: body.format ?? existing.format,
    saveToDrive: body.saveToDrive ?? existing.save_to_drive, filters: body.filters ?? existing.filters, enabled: body.enabled ?? existing.enabled,
  };
  const validated = reportScheduleSchema.safeParse(merged);
  if (!validated.success) return c.json(fail(requestId, 'REPORT_SCHEDULE_INVALID', 'รูปแบบกำหนดการรายงานไม่ถูกต้อง'), 400);
  const patch = validated.data;
  const update = {
    report_key: patch.reportKey, name: patch.name, frequency: patch.frequency, day_of_week: patch.dayOfWeek ?? null, day_of_month: patch.dayOfMonth ?? null,
    run_hour: patch.runHour, timezone: patch.timezone, format: patch.format, save_to_drive: patch.saveToDrive, filters: patch.filters, enabled: patch.enabled,
    next_run_at: nextScheduleAt(patch), updated_by: c.get('userId'),
  };
  const { data, error } = await c.get('supabase').from('report_schedules').update(update).eq('id', c.req.param('id')).eq('created_by', c.get('userId')).select('id,report_key,name,frequency,day_of_week,day_of_month,run_hour,timezone,format,save_to_drive,filters,enabled,next_run_at,last_run_at').single();
  if (error) return c.json(fail(requestId, 'REPORT_SCHEDULE_UPDATE_FAILED', error.message), 400);
  return c.json(ok(requestId, scheduleDto(data as unknown as Row)));
});

reportsRoute.delete('/schedules/:id', requirePermission('report.schedule'), async (c) => {
  const requestId = c.get('requestId');
  const { error } = await c.get('supabase').from('report_schedules').delete().eq('id', c.req.param('id')).eq('created_by', c.get('userId'));
  if (error) return c.json(fail(requestId, 'REPORT_SCHEDULE_DELETE_FAILED', error.message), 400);
  return c.json(ok(requestId, { deleted: true }));
});

reportsRoute.get('/snapshots', async (c) => {
  const requestId = c.get('requestId');
  const reportKey = c.req.query('reportKey');
  let query = c.get('supabase').from('report_snapshots').select('id,report_key,snapshot_kind,title,period_start,period_end,generated_at,created_at').order('created_at', { ascending: false }).limit(100);
  if (reportKey) query = query.eq('report_key', reportKey);
  const { data, error } = await query;
  if (error) return c.json(fail(requestId, 'REPORT_SNAPSHOTS_LOAD_FAILED', error.message), 400);
  return c.json(ok(requestId, (data ?? []).map((row) => ({ id: row.id, reportKey: row.report_key, snapshotKind: row.snapshot_kind, title: row.title, periodStart: row.period_start, periodEnd: row.period_end, generatedAt: row.generated_at, createdAt: row.created_at }))));
});

reportsRoute.get('/executive-pack', zValidator('query', reportExecutivePackQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const permissionResult = await permissionSet(c);
  if (permissionResult.error) return c.json(fail(requestId, 'REPORT_PERMISSIONS_LOAD_FAILED', permissionResult.error), 400);
  try {
    const pack = await buildExecutivePack(c.get('supabase'), permissionResult.permissions, c.req.valid('query').month, createAdminClient(c.env));
    return c.json(ok(requestId, pack));
  } catch (error) {
    return c.json(fail(requestId, 'EXECUTIVE_PACK_LOAD_FAILED', error instanceof Error ? error.message : 'สร้าง Executive Pack ไม่สำเร็จ'), 400);
  }
});

reportsRoute.post('/executive-pack/snapshots', requirePermission('report.export'), zValidator('json', reportExecutivePackSnapshotSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const permissionResult = await permissionSet(c);
  if (permissionResult.error) return c.json(fail(requestId, 'REPORT_PERMISSIONS_LOAD_FAILED', permissionResult.error), 400);
  const body = c.req.valid('json');
  try {
    const pack = await buildExecutivePack(c.get('supabase'), permissionResult.permissions, body.month, createAdminClient(c.env));
    const { data, error } = await createAdminClient(c.env).from('report_snapshots').insert({ report_key: 'executive-pack', snapshot_kind: 'executive_pack', title: body.title ?? pack.title, period_start: pack.periodStart, period_end: pack.periodEnd, filters: body, dataset: pack, generated_at: pack.generatedAt, created_by: c.get('userId') }).select('id,report_key,snapshot_kind,title,period_start,period_end,generated_at,created_at').single();
    if (error) return c.json(fail(requestId, 'REPORT_SNAPSHOT_SAVE_FAILED', error.message), 400);
    return c.json(ok(requestId, { id: data.id, reportKey: data.report_key, snapshotKind: data.snapshot_kind, title: data.title, periodStart: data.period_start, periodEnd: data.period_end, generatedAt: data.generated_at, createdAt: data.created_at }), 201);
  } catch (error) {
    return c.json(fail(requestId, 'EXECUTIVE_PACK_SNAPSHOT_FAILED', error instanceof Error ? error.message : 'บันทึก Executive Pack ไม่สำเร็จ'), 400);
  }
});

reportsRoute.post('/executive-pack/exports/pdf', requirePermission('report.export'), zValidator('json', reportExecutivePackExportSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  if (!c.env.MYBROWSER) return c.json(fail(requestId, 'PDF_EXPORT_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า Browser Rendering สำหรับสร้าง PDF'), 503);
  const permissionResult = await permissionSet(c);
  if (permissionResult.error) return c.json(fail(requestId, 'REPORT_PERMISSIONS_LOAD_FAILED', permissionResult.error), 400);
  const body = c.req.valid('json');
  try {
    const pack = await buildExecutivePack(c.get('supabase'), permissionResult.permissions, body.month, createAdminClient(c.env));
    const pdfBytes = await renderHtmlToPdf(c.env.MYBROWSER, renderExecutivePackHtml(pack));
    const filters: ReportFilters = { rangeDays: 0, from: pack.periodStart, to: pack.periodEnd, comparePrevious: true };
    const logError = await logExport(c, 'executive-pack', 'PDF', filters, pack.sections.reduce((sum, section) => sum + section.totalRows, 0));
    if (logError) return c.json(fail(requestId, 'REPORT_EXPORT_LOG_FAILED', logError), 400);
    const filename = `executive-pack-${body.month}.pdf`;
    const drive = body.saveToDrive ? await copyReportPdfToDrive(c, filename, pdfBytes) : null;
    return c.json(ok(requestId, { filename, pdfBase64: Buffer.from(pdfBytes).toString('base64'), drive: drive?.file ?? null, driveError: drive?.error ?? null }));
  } catch (error) {
    console.error(JSON.stringify({ requestId, code: 'EXECUTIVE_PACK_PDF_FAILED', message: error instanceof Error ? error.message : String(error) }));
    return c.json(fail(requestId, 'EXECUTIVE_PACK_PDF_FAILED', 'สร้าง PDF Executive Pack ไม่สำเร็จ'), 502);
  }
});

reportsRoute.post('/:key/snapshots', requirePermission('report.export'), zValidator('json', reportSnapshotSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const key = c.req.param('key') ?? '';
  const body = c.req.valid('json');
  const result = await datasetFor(c, key, body);
  if (!result.dataset) return c.json(fail(requestId, result.status === 404 ? 'REPORT_NOT_FOUND' : 'REPORT_SNAPSHOT_FAILED', result.error), result.status);
  const title = body.title ?? `${result.dataset.definition.label} Snapshot`;
  const { data, error } = await createAdminClient(c.env).from('report_snapshots').insert({ report_key: key, snapshot_kind: body.snapshotKind, title, period_start: body.from ?? null, period_end: body.to ?? null, filters: body, dataset: result.dataset, generated_at: result.dataset.generatedAt, created_by: c.get('userId') }).select('id,report_key,snapshot_kind,title,period_start,period_end,generated_at,created_at').single();
  if (error) return c.json(fail(requestId, 'REPORT_SNAPSHOT_SAVE_FAILED', error.message), 400);
  return c.json(ok(requestId, { id: data.id, reportKey: data.report_key, snapshotKind: data.snapshot_kind, title: data.title, periodStart: data.period_start, periodEnd: data.period_end, generatedAt: data.generated_at, createdAt: data.created_at }), 201);
});

reportsRoute.get('/:key', zValidator('query', reportRangeQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const result = await datasetFor(c, c.req.param('key') ?? '', c.req.valid('query'));
  if (!result.dataset) return c.json(fail(requestId, result.status === 404 ? 'REPORT_NOT_FOUND' : 'REPORT_LOAD_FAILED', result.error), result.status);
  return c.json(ok(requestId, result.dataset));
});

async function logExport(c: Context<AppEnv>, key: string, format: 'CSV' | 'PRINT' | 'PDF', filters: ReportFilters, rowCount: number) {
  const admin = createAdminClient(c.env);
  const exportCode = `RPT-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomCodeSuffix()}`;
  const { error } = await admin.from('report_exports').insert({ export_code: exportCode, report_key: key, format, filters, row_count: rowCount, actor_id: c.get('userId'), actor_email: c.get('userEmail') });
  if (error) return error.message;
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: `REPORT_EXPORT_${format}`, module: 'report', targetTable: 'report_definitions', targetId: key, detail: { exportCode, filters, rowCount }, requestId: c.get('requestId') });
  return null;
}

reportsRoute.post('/:key/exports/csv', requirePermission('report.export'), zValidator('json', reportExportSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const key = c.req.param('key') ?? ''; const filters = c.req.valid('json');
  const result = await datasetFor(c, key, filters);
  if (!result.dataset) return c.json(fail(requestId, result.status === 404 ? 'REPORT_NOT_FOUND' : 'REPORT_EXPORT_FAILED', result.error), result.status);
  const logError = await logExport(c, key, 'CSV', filters, result.dataset.totalRows);
  if (logError) return c.json(fail(requestId, 'REPORT_EXPORT_LOG_FAILED', logError), 400);
  const stamp = new Date().toISOString().slice(0, 10);
  return c.json(ok(requestId, { filename: `${key}-${stamp}.csv`, csv: reportCsv(result.dataset) }));
});

reportsRoute.post('/:key/exports/print', requirePermission('report.export'), zValidator('json', reportExportSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const key = c.req.param('key') ?? ''; const filters = c.req.valid('json');
  const result = await datasetFor(c, key, filters);
  if (!result.dataset) return c.json(fail(requestId, result.status === 404 ? 'REPORT_NOT_FOUND' : 'REPORT_EXPORT_FAILED', result.error), result.status);
  const logError = await logExport(c, key, 'PRINT', filters, result.dataset.totalRows);
  if (logError) return c.json(fail(requestId, 'REPORT_EXPORT_LOG_FAILED', logError), 400);
  return c.json(ok(requestId, { recorded: true, generatedAt: result.dataset.generatedAt }));
});

/**
 * เก็บสำเนารายงาน PDF ไว้ในโฟลเดอร์ Drive ขององค์กร (โครงสร้างรายปี พ.ศ. เหมือนระบบเดิม)
 * เพื่อให้คนที่ไม่ได้ล็อกอินเข้าระบบเปิดดูรายงานย้อนหลังได้จากที่เดียว
 *
 * คืน error เป็นข้อความแทนการโยน เพราะไฟล์ที่ผู้ใช้ขอสร้างสำเร็จไปแล้ว การล้มของปลายทางเสริม
 * ไม่ควรกลืนผลงานที่เพิ่งใช้ Browser Rendering สร้างมาทั้งชุด
 */
async function copyReportPdfToDrive(
  c: Context<AppEnv>,
  filename: string,
  pdfBytes: Uint8Array,
): Promise<{ file: { id: string; name: string; webViewLink: string } | null; error: string | null }> {
  const requestId = c.get('requestId');
  if (!googleDriveConfig(c.env)) {
    return { file: null, error: 'ยังไม่ได้เปิดใช้งานการเชื่อมต่อ Google Drive' };
  }

  const result = await uploadToDrive(c.env, {
    name: safeDriveName(filename, 'report.pdf'),
    contentType: 'application/pdf',
    content: pdfBytes,
    subFolder: buddhistYearFolder(),
  });

  // ถ้าปล่อยให้ writeAuditLog โยนทะลุออกไป ฟังก์ชันนี้จะผิดสัญญาที่เขียนไว้ข้างบนว่า "คืน error เป็น
  // ข้อความแทนการโยน" — ปลายทาง PDF จะตอบ error ทั้งที่ไฟล์ถูกสร้างและอัปโหลดขึ้น Drive ไปแล้ว
  // ผู้ใช้กดซ้ำก็ได้สำเนาซ้ำใน Drive จึงกลืน error ไว้แล้วรายงานผ่าน console แทน
  try {
    await writeAuditLog(c.env, {
      actorId: c.get('userId'),
      actorEmail: c.get('userEmail'),
      action: 'EXPORT_GOOGLE_DRIVE',
      module: 'google_drive',
      targetId: result.ok ? result.file.id : null,
      detail: { filename, bytes: pdfBytes.byteLength, reason: result.ok ? null : result.reason },
      result: result.ok ? 'success' : 'fail',
      requestId,
    });
  } catch (error) {
    console.error('EXPORT_GOOGLE_DRIVE audit write failed', { requestId, error });
  }

  return result.ok ? { file: result.file, error: null } : { file: null, error: result.message };
}

/**
 * Real server-rendered PDF (R-13: Cloudflare Browser Rendering), distinct from /exports/print's
 * browser print dialog. Not locally testable — see lib/pdf.ts's header comment.
 */
reportsRoute.post('/:key/exports/pdf', requirePermission('report.export'), zValidator('json', reportPdfExportSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const key = c.req.param('key') ?? ''; const { rangeDays, saveToDrive, ...filterOptions } = c.req.valid('json');
  const filters = { rangeDays, ...filterOptions };
  if (!c.env.MYBROWSER) return c.json(fail(requestId, 'PDF_EXPORT_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า Browser Rendering สำหรับสร้าง PDF'), 503);
  const result = await datasetFor(c, key, filters);
  if (!result.dataset) return c.json(fail(requestId, result.status === 404 ? 'REPORT_NOT_FOUND' : 'REPORT_EXPORT_FAILED', result.error), result.status);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderHtmlToPdf(c.env.MYBROWSER, renderReportHtml(result.dataset));
  } catch (error) {
    console.error(JSON.stringify({ requestId, code: 'PDF_RENDER_FAILED', message: error instanceof Error ? error.message : String(error) }));
    return c.json(fail(requestId, 'PDF_RENDER_FAILED', 'สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 502);
  }

  const logError = await logExport(c, key, 'PDF', filters, result.dataset.totalRows);
  if (logError) return c.json(fail(requestId, 'REPORT_EXPORT_LOG_FAILED', logError), 400);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${key}-${stamp}.pdf`;
  const drive = saveToDrive ? await copyReportPdfToDrive(c, filename, pdfBytes) : null;

  // ผู้ใช้ยังได้ไฟล์เสมอแม้สำเนาใน Drive จะล้ม — ส่ง driveError กลับไปให้หน้าเว็บบอกตรง ๆ
  // ว่าดาวน์โหลดสำเร็จแต่สำเนาไม่สำเร็จ ดีกว่าล้มทั้งการส่งออกเพราะปลายทางเสริมมีปัญหา
  return c.json(ok(requestId, {
    filename,
    pdfBase64: Buffer.from(pdfBytes).toString('base64'),
    drive: drive?.file ?? null,
    driveError: drive?.error ?? null,
  }));
});
