import { csvCell } from '@itlife/shared';
import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { renderHtmlToPdf } from '../lib/pdf';
import { renderReportHtml } from '../lib/reportPdfTemplate';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { zodValidationHook } from '../utils/validation';
import { reportExportSchema, reportRangeQuerySchema } from '../validators/reports';

type Row = Record<string, unknown>;
type ReportKey = 'service-desk' | 'requests-workflows' | 'assets-operations' | 'security-resilience' | 'governance-compliance';
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
  amount?: number;
  rating?: number;
}

interface SourceConfig {
  permission: string;
  table: string;
  select: string;
  dateColumn: string;
  sourceLabel: string;
  map: (row: Row) => ReportEntry;
  currentState?: boolean;
}

interface ReportConfig extends ReportDefinition {
  sources: SourceConfig[];
}

const TERMINAL = /ปิด|เสร็จ|สำเร็จ|อนุมัติแล้ว|ยกเลิก|ปฏิเสธ|ผ่าน|inactive|expired|closed|completed|cancelled/i;

function value(row: Row, key: string): string { return row[key] === null || row[key] === undefined ? '' : String(row[key]); }
function numeric(row: Row, key: string): number { const result = Number(row[key]); return Number.isFinite(result) ? result : 0; }
function shortId(row: Row, prefix: string): string { return `${prefix}-${value(row, 'id').slice(0, 8).toUpperCase()}`; }
function dateLabel(input: unknown): string {
  if (!input) return '—';
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? String(input) : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(date);
}
function isOverdue(due: unknown, terminal: boolean): boolean {
  if (!due || terminal) return false;
  const time = new Date(String(due)).getTime();
  return Number.isFinite(time) && time < Date.now();
}

function standardEntry(args: {
  row: Row; source: string; code: string; title: string; status: string; category?: string;
  owner?: string; due?: unknown; created?: unknown; completed?: unknown; warning?: boolean;
  critical?: boolean; amount?: number; rating?: number;
}): ReportEntry {
  const terminal = TERMINAL.test(args.status);
  const createdAt = args.created ? String(args.created) : new Date(0).toISOString();
  return {
    row: {
      source: args.source, code: args.code, title: args.title, status: args.status || '—',
      category: args.category || '—', owner: args.owner || '—', dueDate: dateLabel(args.due), recordDate: dateLabel(args.created),
    },
    createdAt,
    completedAt: args.completed ? String(args.completed) : undefined,
    terminal,
    overdue: isOverdue(args.due, terminal),
    warning: Boolean(args.warning),
    critical: Boolean(args.critical),
    amount: args.amount,
    rating: args.rating,
  };
}

const REPORTS: Record<ReportKey, ReportConfig> = {
  'service-desk': {
    key: 'service-desk', label: 'Service Desk', sortOrder: 10,
    description: 'ปริมาณงาน สถานะ SLA ความเร่งด่วน และความพึงพอใจของ Ticket',
    sourcePermissions: ['ticket.view'],
    sources: [{
      permission: 'ticket.view', table: 'tickets', dateColumn: 'created_at', sourceLabel: 'Ticket',
      select: 'id,title,priority,status,due_at,response_due_at,acknowledged_at,resolved_at,closed_at,rating,created_at,assignee_id',
      map: (row) => standardEntry({ row, source: 'Ticket', code: shortId(row, 'TKT'), title: value(row, 'title'), status: value(row, 'status'), category: value(row, 'priority'), owner: value(row, 'assignee_id'), due: row.due_at, created: row.created_at, completed: row.closed_at ?? row.resolved_at, critical: value(row, 'priority') === 'วิกฤต', rating: row.rating === null ? undefined : numeric(row, 'rating') }),
    }],
  },
  'requests-workflows': {
    key: 'requests-workflows', label: 'Requests & Workflows', sortOrder: 20,
    description: 'คำขอบริการ คำขอสิทธิ์ และกระบวนการอนุมัติในมุมมองเดียว',
    sourcePermissions: ['service_request.view', 'access_request.view', 'workflow.view'],
    sources: [
      { permission: 'service_request.view', table: 'service_requests', dateColumn: 'created_at', sourceLabel: 'Service Request', select: 'id,service_code,service_name,summary,priority,status,approval_status,due_at,closed_at,completed_at,created_at,assignee_id', map: (row) => standardEntry({ row, source: 'Service Request', code: value(row, 'service_code') || shortId(row, 'SR'), title: value(row, 'summary') || value(row, 'service_name'), status: value(row, 'status'), category: value(row, 'priority'), owner: value(row, 'assignee_id'), due: row.due_at, created: row.created_at, completed: row.closed_at ?? row.completed_at }) },
      { permission: 'access_request.view', table: 'access_requests', dateColumn: 'created_at', sourceLabel: 'Access Request', select: 'id,request_type,access_level,status,review_due,created_at,approved_at,it_action_at,it_handler_id', map: (row) => standardEntry({ row, source: 'Access Request', code: shortId(row, 'AR'), title: `${value(row, 'request_type')} · ${value(row, 'access_level')}`, status: value(row, 'status'), category: value(row, 'access_level'), owner: value(row, 'it_handler_id'), due: row.review_due, created: row.created_at, completed: row.it_action_at }) },
      { permission: 'workflow.view', table: 'workflow_instances', dateColumn: 'created_at', sourceLabel: 'Workflow', select: 'id,instance_code,module_key,record_label,status,due_at,started_at,completed_at,created_at,requester_id', map: (row) => standardEntry({ row, source: 'Workflow', code: value(row, 'instance_code'), title: value(row, 'record_label'), status: value(row, 'status'), category: value(row, 'module_key'), owner: value(row, 'requester_id'), due: row.due_at, created: row.started_at ?? row.created_at, completed: row.completed_at }) },
    ],
  },
  'assets-operations': {
    key: 'assets-operations', label: 'Assets & Operations', sortOrder: 30,
    description: 'สินทรัพย์ แผนบำรุงรักษา สต็อก และ License ที่ต้องดูแล',
    sourcePermissions: ['asset.view', 'maintenance.view', 'inventory.view', 'license.view'],
    sources: [
      { permission: 'asset.view', table: 'assets', dateColumn: 'created_at', sourceLabel: 'Asset', currentState: true, select: 'id,asset_code,name,asset_type,status,warranty_expire,price,created_at,owner_employee_id', map: (row) => standardEntry({ row, source: 'Asset', code: value(row, 'asset_code'), title: value(row, 'name'), status: value(row, 'status'), category: value(row, 'asset_type'), owner: value(row, 'owner_employee_id'), due: row.warranty_expire, created: row.created_at, warning: isOverdue(row.warranty_expire, false), amount: numeric(row, 'price') }) },
      { permission: 'maintenance.view', table: 'maintenance_plans', dateColumn: 'created_at', sourceLabel: 'Maintenance', currentState: true, select: 'id,status,recurrence,plan_date,actual_date,next_due_date,created_at,technician_id,asset_id', map: (row) => standardEntry({ row, source: 'Maintenance', code: shortId(row, 'PM'), title: `แผนบำรุงรักษา ${value(row, 'asset_id').slice(0, 8)}`, status: value(row, 'status'), category: value(row, 'recurrence'), owner: value(row, 'technician_id'), due: row.next_due_date ?? row.plan_date, created: row.created_at, completed: row.actual_date }) },
      { permission: 'inventory.view', table: 'inventory_items', dateColumn: 'created_at', sourceLabel: 'Inventory', currentState: true, select: 'id,item_name,category,unit,stock_qty,min_qty,location,status,unit_price,created_at', map: (row) => standardEntry({ row, source: 'Inventory', code: shortId(row, 'INV'), title: value(row, 'item_name'), status: value(row, 'status'), category: value(row, 'category'), owner: value(row, 'location'), created: row.created_at, warning: numeric(row, 'stock_qty') <= numeric(row, 'min_qty'), amount: numeric(row, 'stock_qty') * numeric(row, 'unit_price') }) },
      { permission: 'license.view', table: 'software_licenses', dateColumn: 'created_at', sourceLabel: 'License', currentState: true, select: 'id,software_name,license_type,total_qty,used_qty,expire_date,vendor_name,status,created_at', map: (row) => standardEntry({ row, source: 'License', code: shortId(row, 'LIC'), title: value(row, 'software_name'), status: value(row, 'status'), category: value(row, 'license_type'), owner: value(row, 'vendor_name'), due: row.expire_date, created: row.created_at, warning: isOverdue(row.expire_date, false) || numeric(row, 'used_qty') >= numeric(row, 'total_qty') }) },
    ],
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
  return config.sources.filter((source) => permissions.has(source.permission));
}

async function availableDefinitions(c: Context<AppEnv>, permissions: Set<string>): Promise<{ definitions: ReportDefinition[]; error?: string }> {
  const allowed = Object.values(REPORTS).filter((config) => allowedSources(permissions, config).length > 0);
  const { data, error } = await c.get('supabase').from('report_definitions').select('key,label,description,required_permissions,sort_order').eq('status', 'active').order('sort_order');
  if (error) return { definitions: [], error: error.message };
  const database = new Map((data ?? []).map((row) => [String(row.key), row]));
  return {
    definitions: allowed.map((config) => {
      const row = database.get(config.key);
      return { key: config.key, label: row ? String(row.label) : config.label, description: row ? String(row.description) : config.description, sourcePermissions: config.sourcePermissions, sortOrder: row ? Number(row.sort_order) : config.sortOrder };
    }).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

async function loadEntries(c: Context<AppEnv>, permissions: Set<string>, config: ReportConfig, rangeDays: number): Promise<{ entries: ReportEntry[]; error?: string }> {
  const sources = allowedSources(permissions, config);
  if (!sources.length) return { entries: [], error: 'ไม่มีสิทธิ์เข้าถึงแหล่งข้อมูลของรายงานนี้' };
  const since = new Date(Date.now() - rangeDays * 86_400_000).toISOString();
  const results = await Promise.all(sources.map(async (source) => {
    let query = c.get('supabase').from(source.table).select(source.select).order(source.dateColumn, { ascending: false }).limit(2000);
    if (rangeDays > 0 && !source.currentState) query = query.gte(source.dateColumn, since);
    const { data, error } = await query;
    return { source, data: (data ?? []) as unknown as Row[], error };
  }));
  const error = results.find((result) => result.error)?.error;
  if (error) return { entries: [], error: error.message };
  return { entries: results.flatMap((result) => result.data.map(result.source.map)) };
}

function countBy(entries: ReportEntry[], key: 'source' | 'status'): { label: string; value: number }[] {
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

function buildDataset(config: ReportConfig, definition: ReportDefinition, entries: ReportEntry[], rangeDays: number) {
  const open = entries.filter((entry) => !entry.terminal).length;
  const completed = entries.filter((entry) => entry.terminal).length;
  const overdue = entries.filter((entry) => entry.overdue).length;
  const warning = entries.filter((entry) => entry.warning).length;
  const critical = entries.filter((entry) => entry.critical && !entry.terminal).length;
  const amount = entries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const ratings = entries.flatMap((entry) => entry.rating === undefined ? [] : [entry.rating]);
  let metrics = [metric('รายการทั้งหมด', entries.length, 'primary'), metric('กำลังดำเนินการ', open, open ? 'amber' : 'gray'), metric('เกินกำหนด', overdue, overdue ? 'danger' : 'teal'), metric('เสร็จสิ้น', completed, 'teal')];
  if (config.key === 'service-desk') metrics = [metric('Ticket ทั้งหมด', entries.length, 'primary'), metric('งานเปิด', open, open ? 'amber' : 'gray'), metric('เกิน SLA / กำหนด', overdue, overdue ? 'danger' : 'teal'), metric('CSAT เฉลี่ย', ratings.length ? `${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)}/5` : '—', 'teal', `${ratings.length} คำตอบ`)];
  if (config.key === 'assets-operations') metrics = [metric('รายการที่ดูแล', entries.length, 'primary'), metric('มูลค่าที่บันทึก', amount.toLocaleString('th-TH', { maximumFractionDigits: 2 }), 'teal', 'บาท'), metric('ต้องติดตาม', warning + overdue, warning + overdue ? 'amber' : 'teal'), metric('เสร็จ/ไม่ใช้งาน', completed, 'gray')];
  if (config.key === 'security-resilience') metrics = [metric('เหตุการณ์/การตรวจ', entries.length, 'primary'), metric('ยังเปิดอยู่', open, open ? 'amber' : 'teal'), metric('ระดับสูง/วิกฤต', critical, critical ? 'danger' : 'teal'), metric('เกินกำหนด', overdue, overdue ? 'danger' : 'teal')];
  if (config.key === 'governance-compliance') metrics = [metric('รายการกำกับดูแล', entries.length, 'primary'), metric('ยังเปิดอยู่', open, open ? 'amber' : 'teal'), metric('ความเสี่ยง/ข้อค้นพบสูง', critical, critical ? 'danger' : 'teal'), metric('เกินกำหนด/หมดอายุ', overdue + warning, overdue + warning ? 'danger' : 'teal')];
  const alerts: string[] = [];
  if (overdue) alerts.push(`มี ${overdue} รายการเกินกำหนดและยังไม่ปิด`);
  if (critical) alerts.push(`มี ${critical} รายการระดับสูงหรือวิกฤตที่ยังเปิดอยู่`);
  if (warning) alerts.push(`มี ${warning} รายการที่ถึงเกณฑ์เตือน ต้องตรวจสอบรายละเอียด`);
  return {
    definition, metrics, alerts,
    breakdowns: [{ label: 'แยกตามแหล่งข้อมูล', items: countBy(entries, 'source') }, { label: 'แยกตามสถานะ', items: countBy(entries, 'status') }],
    trend: trend(entries), trendLabels: { primary: 'สร้าง', secondary: 'เสร็จสิ้น' },
    columns: [
      { key: 'source', label: 'แหล่งข้อมูล' }, { key: 'code', label: 'รหัส' }, { key: 'title', label: 'รายการ' },
      { key: 'status', label: 'สถานะ' }, { key: 'category', label: 'ประเภท/ระดับ' }, { key: 'owner', label: 'ผู้รับผิดชอบ' },
      { key: 'dueDate', label: 'ครบกำหนด' }, { key: 'recordDate', label: 'วันที่บันทึก' },
    ],
    rows: entries.map((entry) => entry.row), totalRows: entries.length, rangeDays, generatedAt: new Date().toISOString(),
  };
}

/** re-export ตัวกลางเพื่อให้จุดเรียกเดิมยังใช้ path นี้ได้ */
export { csvCell };

export function reportCsv(dataset: ReturnType<typeof buildDataset>): string {
  const header = dataset.columns.map((column) => csvCell(column.label)).join(',');
  const lines = dataset.rows.map((row) => dataset.columns.map((column) => csvCell(row[column.key])).join(','));
  return [header, ...lines].join('\r\n');
}

async function datasetFor(c: Context<AppEnv>, key: string, rangeDays: number) {
  const config = REPORTS[key as ReportKey];
  if (!config) return { status: 404 as const, error: 'ไม่พบรายงานที่ระบุ' };
  const permissionResult = await permissionSet(c);
  if (permissionResult.error) return { status: 400 as const, error: permissionResult.error };
  const definitions = await availableDefinitions(c, permissionResult.permissions);
  if (definitions.error) return { status: 400 as const, error: definitions.error };
  const definition = definitions.definitions.find((item) => item.key === config.key);
  if (!definition) return { status: 403 as const, error: 'ไม่มีสิทธิ์เข้าถึงแหล่งข้อมูลของรายงานนี้' };
  const loaded = await loadEntries(c, permissionResult.permissions, config, rangeDays);
  if (loaded.error) return { status: 400 as const, error: loaded.error };
  return { status: 200 as const, dataset: buildDataset(config, definition, loaded.entries, rangeDays) };
}

reportsRoute.get('/', zValidator('query', reportRangeQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const { rangeDays } = c.req.valid('query');
  const permissionResult = await permissionSet(c);
  if (permissionResult.error) return c.json(fail(requestId, 'REPORT_PERMISSIONS_LOAD_FAILED', permissionResult.error), 400);
  const result = await availableDefinitions(c, permissionResult.permissions);
  if (result.error) return c.json(fail(requestId, 'REPORT_DEFINITIONS_LOAD_FAILED', result.error), 400);
  return c.json(ok(requestId, { definitions: result.definitions, metrics: [metric('รายงานที่เข้าถึงได้', result.definitions.length, 'primary')], alerts: [], rangeDays, generatedAt: new Date().toISOString() }));
});

reportsRoute.get('/:key', zValidator('query', reportRangeQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const result = await datasetFor(c, c.req.param('key') ?? '', c.req.valid('query').rangeDays);
  if (!result.dataset) return c.json(fail(requestId, result.status === 404 ? 'REPORT_NOT_FOUND' : 'REPORT_LOAD_FAILED', result.error), result.status);
  return c.json(ok(requestId, result.dataset));
});

async function logExport(c: Context<AppEnv>, key: string, format: 'CSV' | 'PRINT' | 'PDF', rangeDays: number, rowCount: number) {
  const admin = createAdminClient(c.env);
  const exportCode = `RPT-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomCodeSuffix()}`;
  const { error } = await admin.from('report_exports').insert({ export_code: exportCode, report_key: key, format, filters: { rangeDays }, row_count: rowCount, actor_id: c.get('userId'), actor_email: c.get('userEmail') });
  if (error) return error.message;
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: `REPORT_EXPORT_${format}`, module: 'report', targetTable: 'report_definitions', targetId: key, detail: { exportCode, rangeDays, rowCount }, requestId: c.get('requestId') });
  return null;
}

reportsRoute.post('/:key/exports/csv', requirePermission('report.export'), zValidator('json', reportExportSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const key = c.req.param('key') ?? ''; const { rangeDays } = c.req.valid('json');
  const result = await datasetFor(c, key, rangeDays);
  if (!result.dataset) return c.json(fail(requestId, result.status === 404 ? 'REPORT_NOT_FOUND' : 'REPORT_EXPORT_FAILED', result.error), result.status);
  const logError = await logExport(c, key, 'CSV', rangeDays, result.dataset.totalRows);
  if (logError) return c.json(fail(requestId, 'REPORT_EXPORT_LOG_FAILED', logError), 400);
  const stamp = new Date().toISOString().slice(0, 10);
  return c.json(ok(requestId, { filename: `${key}-${stamp}.csv`, csv: reportCsv(result.dataset) }));
});

reportsRoute.post('/:key/exports/print', requirePermission('report.export'), zValidator('json', reportExportSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const key = c.req.param('key') ?? ''; const { rangeDays } = c.req.valid('json');
  const result = await datasetFor(c, key, rangeDays);
  if (!result.dataset) return c.json(fail(requestId, result.status === 404 ? 'REPORT_NOT_FOUND' : 'REPORT_EXPORT_FAILED', result.error), result.status);
  const logError = await logExport(c, key, 'PRINT', rangeDays, result.dataset.totalRows);
  if (logError) return c.json(fail(requestId, 'REPORT_EXPORT_LOG_FAILED', logError), 400);
  return c.json(ok(requestId, { recorded: true, generatedAt: result.dataset.generatedAt }));
});

/**
 * Real server-rendered PDF (R-13: Cloudflare Browser Rendering), distinct from /exports/print's
 * browser print dialog. Not locally testable — see lib/pdf.ts's header comment.
 */
reportsRoute.post('/:key/exports/pdf', requirePermission('report.export'), zValidator('json', reportExportSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId'); const key = c.req.param('key') ?? ''; const { rangeDays } = c.req.valid('json');
  if (!c.env.MYBROWSER) return c.json(fail(requestId, 'PDF_EXPORT_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า Browser Rendering สำหรับสร้าง PDF'), 503);
  const result = await datasetFor(c, key, rangeDays);
  if (!result.dataset) return c.json(fail(requestId, result.status === 404 ? 'REPORT_NOT_FOUND' : 'REPORT_EXPORT_FAILED', result.error), result.status);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderHtmlToPdf(c.env.MYBROWSER, renderReportHtml(result.dataset));
  } catch (error) {
    console.error(JSON.stringify({ requestId, code: 'PDF_RENDER_FAILED', message: error instanceof Error ? error.message : String(error) }));
    return c.json(fail(requestId, 'PDF_RENDER_FAILED', 'สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 502);
  }

  const logError = await logExport(c, key, 'PDF', rangeDays, result.dataset.totalRows);
  if (logError) return c.json(fail(requestId, 'REPORT_EXPORT_LOG_FAILED', logError), 400);

  const stamp = new Date().toISOString().slice(0, 10);
  return c.json(ok(requestId, { filename: `${key}-${stamp}.pdf`, pdfBase64: Buffer.from(pdfBytes).toString('base64') }));
});
