import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { buildExecutiveServiceAnalytics } from '../services/dashboardAnalyticsService';
import { ticketSlaState } from '../services/ticketSlaStatus';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { dashboardSummaryQuerySchema, myWorkSavedViewSchema, myWorkSnoozeSchema } from '../validators/dashboard';

type Row = Record<string, unknown>;
type Tone = 'teal' | 'amber' | 'danger' | 'gray' | 'primary';
type ViewMode = 'executive' | 'privacy' | 'operations' | 'personal';

interface SourceDefinition {
  key: string;
  label: string;
  permission: string;
  table: string;
  select: string;
  path: string;
  title: (row: Row) => string;
  status: (row: Row) => string;
  due: (row: Row) => string | null;
  terminal: (row: Row) => boolean;
  warning?: (row: Row) => boolean;
  paused?: (row: Row) => boolean;
}

const TERMINAL_TICKET = new Set(['เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident']);
const TERMINAL_REQUEST = new Set(['ปิดงาน', 'ปฏิเสธ', 'ยกเลิก']);
const TERMINAL_TASK = new Set(['เสร็จแล้ว', 'ยกเลิก']);
const TERMINAL_INCIDENT = new Set(['ปิด', 'ปิดเคส', 'ปิดเหตุการณ์', 'ยกเลิก']);

function text(row: Row, key: string): string {
  return row[key] === null || row[key] === undefined ? '' : String(row[key]);
}

function date(row: Row, key: string): string | null {
  const value = text(row, key);
  return value || null;
}

function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const due = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  return Math.floor((due.getTime() - today) / 86_400_000);
}

const SOURCES: SourceDefinition[] = [
  { key: 'tickets', label: 'Ticket', permission: 'ticket.view', table: 'tickets', select: 'id,ticket_no,title,status,priority,due_at,sla_paused_at,requester_id,assignee_id,assignee_name_snapshot,created_at,acknowledged_at,resolved_at,closed_at,rating,feedback_at,ticket_categories(name)', path: '/tickets', title: (r) => text(r, 'title'), status: (r) => text(r, 'status'), due: (r) => date(r, 'due_at'), terminal: (r) => TERMINAL_TICKET.has(text(r, 'status')), paused: (r) => Boolean(r.sla_paused_at) },
  { key: 'service-requests', label: 'คำขอบริการ', permission: 'service_request.view', table: 'service_requests', select: 'id,service_code,service_name,summary,status,priority,approval_status,due_at,requester_id,assignee_id,created_at', path: '/service-requests', title: (r) => text(r, 'summary') || text(r, 'service_name'), status: (r) => text(r, 'status'), due: (r) => date(r, 'due_at'), terminal: (r) => TERMINAL_REQUEST.has(text(r, 'status')) },
  { key: 'tasks', label: 'งานของฉัน', permission: 'task.view', table: 'personal_tasks', select: 'id,title,status,priority,due_date,created_at', path: '/tasks', title: (r) => text(r, 'title'), status: (r) => text(r, 'status'), due: (r) => date(r, 'due_date'), terminal: (r) => TERMINAL_TASK.has(text(r, 'status')) },
  { key: 'assets', label: 'ประกันทรัพย์สิน', permission: 'asset.view', table: 'assets', select: 'id,asset_code,name,status,warranty_expire,created_at', path: '/assets', title: (r) => `${text(r, 'asset_code')} ${text(r, 'name')}`.trim(), status: (r) => text(r, 'status'), due: (r) => date(r, 'warranty_expire'), terminal: (r) => text(r, 'status') === 'จำหน่าย/เลิกใช้' },
  { key: 'licenses', label: 'Software License', permission: 'license.view', table: 'software_licenses', select: 'id,software_name,status,expire_date,total_qty,used_qty,created_at', path: '/software-licenses', title: (r) => text(r, 'software_name'), status: (r) => text(r, 'status'), due: (r) => date(r, 'expire_date'), terminal: (r) => ['Expired', 'Inactive'].includes(text(r, 'status')) },
  { key: 'maintenance', label: 'แผนบำรุงรักษา', permission: 'maintenance.view', table: 'maintenance_plans', select: 'id,status,plan_date,next_due_date,asset_id,created_at', path: '/maintenance', title: (r) => `แผนบำรุงรักษา ${text(r, 'asset_id').slice(0, 8)}`, status: (r) => text(r, 'status'), due: (r) => date(r, 'next_due_date') ?? date(r, 'plan_date'), terminal: (r) => ['ดำเนินการแล้ว', 'ยกเลิก'].includes(text(r, 'status')) },
  { key: 'inventory', label: 'วัสดุใกล้หมด', permission: 'inventory.view', table: 'inventory_items', select: 'id,item_name,status,stock_qty,min_qty,created_at', path: '/inventory-items', title: (r) => text(r, 'item_name'), status: (r) => Number(r.stock_qty ?? 0) <= Number(r.min_qty ?? 0) ? 'ต่ำกว่าจุดสั่งซื้อ' : 'เพียงพอ', due: () => null, terminal: (r) => text(r, 'status') === 'inactive', warning: (r) => text(r, 'status') === 'active' && Number(r.stock_qty ?? 0) <= Number(r.min_qty ?? 0) },
  { key: 'contracts', label: 'สัญญาผู้ให้บริการ', permission: 'contract.view', table: 'contracts', select: 'id,contract_number,name,status,end_date,created_at', path: '/vendors-contracts', title: (r) => `${text(r, 'contract_number')} ${text(r, 'name')}`.trim(), status: (r) => text(r, 'status'), due: (r) => date(r, 'end_date'), terminal: (r) => ['Expired', 'Terminated', 'Renewed'].includes(text(r, 'status')) },
  { key: 'access-reviews', label: 'ทบทวนสิทธิ์', permission: 'access_request.view', table: 'user_access_registry', select: 'id,access_level,status,next_review_due,system_id,user_id,created_at', path: '/access-requests', title: (r) => `สิทธิ์ ${text(r, 'access_level')} · ${text(r, 'system_id').slice(0, 8)}`, status: (r) => text(r, 'status'), due: (r) => date(r, 'next_review_due'), terminal: (r) => ['revoked', 'suspended'].includes(text(r, 'status')) },
  { key: 'log-reviews', label: 'ตรวจสอบ Log', permission: 'monitoring.view', table: 'logging_systems', select: 'id,log_system_code,system_name,status,next_review_due,created_at', path: '/backup-monitoring', title: (r) => `${text(r, 'log_system_code')} ${text(r, 'system_name')}`.trim(), status: (r) => text(r, 'status'), due: (r) => date(r, 'next_review_due'), terminal: (r) => text(r, 'status') === 'ระงับ' },
  { key: 'backups', label: 'สำรองข้อมูล', permission: 'backup.view', table: 'backup_logs', select: 'id,backup_code,system_name,result,next_backup_due,backup_date,created_at', path: '/backup-monitoring', title: (r) => `${text(r, 'backup_code')} ${text(r, 'system_name')}`.trim(), status: (r) => text(r, 'result'), due: (r) => date(r, 'next_backup_due'), terminal: () => false, warning: (r) => /ล้มเหลว|บางส่วน/.test(text(r, 'result')) },
  { key: 'awareness', label: 'อบรม Awareness', permission: 'awareness.view', table: 'governance_training_plans', select: 'id,plan_code,topic,status,planned_date,completed_at,created_at', path: '/governance', title: (r) => `${text(r, 'plan_code')} ${text(r, 'topic')}`.trim(), status: (r) => text(r, 'status'), due: (r) => date(r, 'planned_date'), terminal: (r) => Boolean(r.completed_at) || /เสร็จ|ยกเลิก/.test(text(r, 'status')) },
  { key: 'incidents', label: 'Incident', permission: 'incident.view', table: 'incidents', select: 'id,incident_number,title,severity,status,contains_personal_data,dpo_notify_deadline,reported_by,assignee_id,report_date,created_at', path: '/incidents', title: (r) => `${text(r, 'incident_number')} ${text(r, 'title')}`.trim(), status: (r) => text(r, 'status'), due: (r) => date(r, 'dpo_notify_deadline'), terminal: (r) => TERMINAL_INCIDENT.has(text(r, 'status')) },
];

function modeFor(roles: string[]): ViewMode {
  if (roles.includes('executive')) return 'executive';
  if (roles.includes('dpo')) return 'privacy';
  if (roles.some((role) => ['manager', 'auditor'].includes(role))) return 'executive';
  if (roles.some((role) => ['super_admin', 'it_admin', 'technician', 'approver'].includes(role))) return 'operations';
  return 'personal';
}

function toneFor(total: number, warning: number, overdue: number): Tone {
  if (overdue > 0) return 'danger';
  if (warning > 0) return 'amber';
  return total > 0 ? 'teal' : 'gray';
}

/**
 * เดิมทุกแหล่งข้อมูลถูกดึงด้วย `.limit(2000)` เฉย ๆ ซึ่งพังสองชั้น:
 *
 *  1. ไม่มี `.order()` — PostgREST จึงคืน "2000 แถวไหนก็ได้" ตัวเลขบนการ์ดเปลี่ยนไปมาระหว่างรีเฟรช
 *     และเมื่อข้อมูลเกิน 2000 แถว ยอดรวมจะหยุดนิ่งที่ 2000 โดยไม่มีอะไรบอกผู้ใช้ว่าถูกตัด
 *  2. โหมด personal กรองด้วย requester/assignee "หลังจาก" ดึงมาแล้ว ผู้ใช้ที่งานของตัวเองไม่ติดอยู่
 *     ใน 2000 แถวแรกที่สุ่มได้จะเห็นเป็นศูนย์ทั้งที่มีงานค้างอยู่จริง
 *
 * (พบตอน Pre-production QA audit 2026-08-13)
 *
 * แก้โดยให้ฐานข้อมูลกรองและนับให้ (`count: 'exact'`) แล้วไล่ดึงทีละหน้าอย่างมีลำดับแน่นอน
 * ยอดรวมบนการ์ดจึงมาจากฐานข้อมูลจริงเสมอ แม้แถวที่ดึงมาคำนวณจะถูกจำกัดด้วยเพดานความปลอดภัย
 */
const PAGE_SIZE = 1000;
const MAX_SCAN_ROWS = 10_000;

/** คอลัมน์ที่ถือว่า "เป็นงานของผู้ใช้คนนี้" ในโหมด personal */
const PERSONAL_COLUMNS: Record<string, string[]> = {
  tickets: ['requester_id', 'assignee_id'],
  'service-requests': ['requester_id', 'assignee_id'],
  incidents: ['reported_by', 'assignee_id'],
  'access-reviews': ['user_id'],
};

interface LoadedSource {
  source: SourceDefinition;
  rows: Row[];
  total: number;
  truncated: boolean;
  error: { message: string; code?: string } | null;
}

interface DashboardDecision {
  id: string;
  source: string;
  title: string;
  reason: string;
  path: string;
}

interface DashboardTrend {
  label: string;
  current: number;
  previous: number;
  delta: number;
  percent: number | null;
  sampled: boolean;
}

function dashboardPath(path: string, leadDays: number, params: Record<string, string> = {}): string {
  const [pathname, query = ''] = path.split('?');
  const search = new URLSearchParams(query);
  search.set('fromDashboard', '1');
  search.set('dashboardRange', String(leadDays));
  for (const [key, value] of Object.entries(params)) search.set(key, value);
  return `${pathname}?${search.toString()}`;
}

function dashboardTrend(loaded: LoadedSource[], now = new Date()): DashboardTrend {
  const currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();
  const previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).getTime();
  const isCreatedBetween = (row: Row, start: number, end: number) => {
    const createdAt = Date.parse(text(row, 'created_at'));
    return Number.isFinite(createdAt) && createdAt >= start && createdAt < end;
  };
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).getTime();
  const rows = loaded.flatMap((item) => item.rows);
  const current = rows.filter((row) => isCreatedBetween(row, currentStart, nextMonth)).length;
  const previous = rows.filter((row) => isCreatedBetween(row, previousStart, currentStart)).length;
  const delta = current - previous;
  return {
    label: 'รายการที่สร้าง',
    current,
    previous,
    delta,
    percent: previous === 0 ? (current === 0 ? 0 : null) : Math.round(delta / previous * 100),
    sampled: loaded.some((item) => item.truncated),
  };
}

async function loadSource(
  supabase: AppEnv['Variables']['supabase'],
  source: SourceDefinition,
  mode: ViewMode,
  actorId: string,
): Promise<LoadedSource> {
  // actorId มาจาก JWT ที่ตรวจลายเซ็นแล้วใน middleware จึงเป็น UUID เสมอ ไม่ใช่ค่าที่ผู้เรียกกำหนดเอง
  const personalColumns = mode === 'personal' ? PERSONAL_COLUMNS[source.key] : undefined;

  const buildQuery = () => {
    let query = supabase
      .from(source.table)
      .select(source.select, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true });
    if (personalColumns) query = query.or(personalColumns.map((column) => `${column}.eq.${actorId}`).join(','));
    return query;
  };

  const rows: Row[] = [];
  let total = 0;

  // เดินหน้าตามจำนวนแถวที่ "ได้จริง" และหยุดเมื่อครบตาม count ของฐานข้อมูล ไม่ใช่เมื่อหน้าใดหน้าหนึ่ง
  // สั้นกว่า PAGE_SIZE — PostgREST มีเพดาน max-rows ของตัวเอง (โปรเจกต์นี้ตั้งไว้ 1000 ทำให้
  // `.limit(2000)` ของโค้ดเดิมไม่เคยมีผลเลย ได้จริงแค่ 1000 แถว) ถ้ายึดขนาดหน้าเป็นเงื่อนไขหยุด
  // โปรเจกต์ที่ตั้งเพดานต่ำกว่านี้จะทำให้ลูปจบก่อนเวลาแบบเงียบ ๆ อีกครั้ง
  while (rows.length < MAX_SCAN_ROWS) {
    const { data, count, error } = await buildQuery().range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) return { source, rows: [], total: 0, truncated: false, error };

    total = count ?? rows.length + (data?.length ?? 0);
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length === 0 || rows.length >= total) break;
  }

  return { source, rows, total, truncated: total > rows.length, error: null };
}

export const dashboardRoute = new Hono<AppEnv>();
dashboardRoute.use('*', requireAuth);
dashboardRoute.use('*', requirePermission('dashboard.view'));

type MyWorkKind =
  | 'ticket'
  | 'service_request'
  | 'task'
  | 'service_approval'
  | 'access_approval'
  | 'access_fulfillment'
  | 'workflow_approval'
  | 'incident'
  | 'problem'
  | 'change_test'
  | 'change_approval'
  | 'vulnerability'
  | 'backup'
  | 'recovery_test'
  | 'log_review'
  | 'contract_renewal'
  | 'license_renewal'
  | 'governance_capa'
  | 'risk_treatment'
  | 'audit_finding';

type MyWorkSlaState = 'overdue' | 'due_soon' | 'on_track' | 'paused' | 'none';

const MY_WORK_KINDS = new Set<MyWorkKind>([
  'ticket', 'service_request', 'task', 'service_approval', 'access_approval', 'access_fulfillment', 'workflow_approval',
  'incident', 'problem', 'change_test', 'change_approval', 'vulnerability', 'backup', 'recovery_test', 'log_review',
  'contract_renewal', 'license_renewal', 'governance_capa', 'risk_treatment', 'audit_finding',
]);

interface MyWorkItem {
  id: string;
  kind: MyWorkKind;
  source: string;
  title: string;
  status: string;
  priority: string | null;
  dueAt: string | null;
  slaPaused?: boolean;
  riskScore: number | null;
  slaState: MyWorkSlaState;
  slaRemainingSeconds: number | null;
  isOverdue: boolean;
  snoozedUntil: string | null;
  path: string;
  action: string;
}

type RawMyWorkItem = Omit<MyWorkItem, 'riskScore' | 'slaState' | 'slaRemainingSeconds' | 'isOverdue' | 'snoozedUntil'> & { riskScore?: number | null };

interface MyWorkQueueItem {
  id: string;
  kind: MyWorkKind;
  source: string;
  title: string;
  status: string;
  priority: string | null;
  dueAt: string | null;
  riskScore: number | null;
  path: string;
}

interface MyWorkSavedView {
  id: string;
  name: string;
  scope: string;
  sourceKind: string | null;
  sortBy: string;
  updatedAt: string;
}

function scoreFromLabel(value: unknown): number | null {
  const label = String(value ?? '').toLowerCase();
  if (!label) return null;
  if (/(วิกฤต|critical)/i.test(label)) return 25;
  if (/(สูง|high|major)/i.test(label)) return 16;
  if (/(กลาง|ปานกลาง|medium|moderate)/i.test(label)) return 9;
  if (/(ต่ำ|low|minor)/i.test(label)) return 4;
  return null;
}

function numericOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function itemSlaState(dueAt: string | null, paused = false, now = Date.now()): MyWorkSlaState {
  if (paused) return 'paused';
  if (!dueAt) return 'none';
  const timestamp = Date.parse(dueAt);
  if (!Number.isFinite(timestamp)) return 'none';
  if (timestamp < now) return 'overdue';
  return timestamp - now <= 4 * 60 * 60 * 1000 ? 'due_soon' : 'on_track';
}

function workOwnerMatches(row: Row, fields: string[], tokens: string[]): boolean {
  const values = fields.map((field) => text(row, field).trim().toLowerCase()).filter(Boolean);
  return values.some((value) => tokens.some((token) => value === token));
}

function riskScore(row: Row, fields: string[]): number | null {
  for (const field of fields) {
    const numeric = numericOrNull(row[field]);
    if (numeric !== null) return numeric;
    const labelScore = scoreFromLabel(row[field]);
    if (labelScore !== null) return labelScore;
  }
  return null;
}

function itemSort(left: Pick<MyWorkItem, 'riskScore' | 'slaState' | 'dueAt' | 'title'>, right: Pick<MyWorkItem, 'riskScore' | 'slaState' | 'dueAt' | 'title'>): number {
  const slaRank: Record<MyWorkSlaState, number> = { overdue: 0, due_soon: 1, on_track: 2, paused: 3, none: 4 };
  return (right.riskScore ?? -1) - (left.riskScore ?? -1)
    || slaRank[left.slaState] - slaRank[right.slaState]
    || (left.dueAt ? Date.parse(left.dueAt) : Number.MAX_SAFE_INTEGER) - (right.dueAt ? Date.parse(right.dueAt) : Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title, 'th');
}

function queueSort(left: MyWorkQueueItem, right: MyWorkQueueItem): number {
  const leftSla = itemSlaState(left.dueAt);
  const rightSla = itemSlaState(right.dueAt);
  return itemSort({ ...left, slaState: leftSla }, { ...right, slaState: rightSla });
}

function validWorkKind(value: string): value is MyWorkKind {
  return MY_WORK_KINDS.has(value as MyWorkKind);
}

function workKey(kind: MyWorkKind, id: string): string {
  return `${kind}:${id}`;
}

dashboardRoute.get('/my-work', async (c) => {
  const requestId = c.get('requestId');
  const actorId = c.get('userId');
  const supabase = c.get('supabase');
  const admin = createAdminClient(c.env);
  const { data: permissionRows, error: permissionError } = await supabase.rpc('my_permissions');
  if (permissionError) return dbFailJson(c, 'MY_WORK_PERMISSIONS_FAILED', permissionError);
  const permissions = new Set((permissionRows ?? []).map((row: { permission_key: string }) => row.permission_key));
  const ownerProfileResult = await admin.from('profiles').select('id,full_name,email').eq('id', actorId).maybeSingle();
  const ownerProfile = ownerProfileResult.data as { full_name?: string | null; email?: string | null } | null;
  const ownerTokens = [actorId, ownerProfile?.full_name, ownerProfile?.email].filter((value): value is string => Boolean(value)).map((value) => value.trim().toLowerCase());

  const [groupsResult, ticketsResult, requestsResult, tasksResult, accessApprovalsResult, accessFulfillmentResult, workflowResult,
    incidentResult, problemResult, changeTestResult, changeApprovalResult, vulnerabilityResult, backupResult, recoveryResult,
    logSystemResult, logReviewResult, contractResult, licenseResult, capaResult, riskResult, findingResult,
    teamTicketsResult, teamRequestsResult, teamIncidentsResult, teamProblemsResult, teamContractsResult, snoozesResult, savedViewsResult] = await Promise.all([
    supabase.from('approval_group_members').select('group_id').eq('user_id', actorId).eq('status', 'active'),
    permissions.has('ticket.view')
      ? supabase.from('tickets').select('id,ticket_no,title,status,priority,due_at,sla_paused_at').eq('assignee_id', actorId).not('status', 'in', '(เสร็จสิ้น,ปิดงาน,ยกเลิก,ยกระดับเป็น Incident)').order('due_at').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('service_request.view')
      ? supabase.from('service_requests').select('id,service_code,summary,service_name,status,priority,due_at').eq('assignee_id', actorId).not('status', 'in', '(ปิดงาน,ปฏิเสธ,ยกเลิก)').order('due_at').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('task.view')
      ? supabase.from('personal_tasks').select('id,title,status,priority,due_date').eq('owner_id', actorId).not('status', 'in', '(เสร็จแล้ว,ยกเลิก)').order('due_date').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('access_request.view')
      ? supabase.from('access_requests').select('id,status,access_level,review_due,access_systems(name),access_control_item:access_control_items!access_requests_access_item_id_fkey(kind,name)').eq('approver_id', actorId).eq('status', 'รออนุมัติจากหัวหน้างาน').order('created_at').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('access_request.process')
      ? supabase.from('access_requests').select('id,status,access_level,review_due,access_systems(name),access_control_item:access_control_items!access_requests_access_item_id_fkey(kind,name)').eq('status', 'รอส่วนงานไอทีดำเนินการ').or(`it_handler_id.is.null,it_handler_id.eq.${actorId}`).order('created_at').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('workflow.approve')
      ? admin.from('workflow_approvals').select('id,status,due_at,workflow_instances(instance_code,record_label)').eq('approver_id', actorId).eq('status', 'รอพิจารณา').order('due_at').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('incident.view')
      ? supabase.from('incidents').select('id,incident_number,title,severity,risk_score,status,dpo_notify_deadline,assignee_id').eq('assignee_id', actorId).not('status', 'eq', 'ปิดเคส').order('dpo_notify_deadline').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('problem.view')
      ? supabase.from('problems').select('id,problem_number,title,priority,status,review_date,owner_id').eq('owner_id', actorId).not('status', 'eq', 'ปิด').order('review_date').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('change.test')
      ? supabase.from('change_requests').select('id,change_number,title,risk_level,status,requester_id,request_date').eq('status', 'ยื่นคำขอ').neq('requester_id', actorId).order('request_date').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('change.approve')
      ? supabase.from('change_requests').select('id,change_number,title,risk_level,status,requester_id,test_signoff_by,request_date').eq('status', 'ผ่านการทดสอบ').neq('requester_id', actorId).neq('test_signoff_by', actorId).order('request_date').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('vulnerability.view')
      ? supabase.from('vulnerability_findings').select('id,vulnerability_code,title,severity,cvss,status,due_date,owner_id').eq('owner_id', actorId).not('status', 'eq', 'ปิด').order('due_date').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('backup.view')
      ? supabase.from('backup_logs').select('id,backup_code,system_name,result,next_backup_due,operator_id').eq('operator_id', actorId).order('next_backup_due').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('backup.view')
      ? supabase.from('recovery_tests').select('id,recovery_code,system_name,result,next_test_due,tester_id').eq('tester_id', actorId).order('next_test_due').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('monitoring.view')
      ? supabase.from('logging_systems').select('id,log_system_code,system_name,status,next_review_due,responsible_id').eq('responsible_id', actorId).eq('status', 'ใช้งาน').order('next_review_due').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('monitoring.view')
      ? supabase.from('log_reviews').select('id,review_code,period,status,review_date,anomaly_found,reviewer_id').eq('reviewer_id', actorId).neq('status', 'แก้ไขแล้ว').order('review_date', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('contract.view')
      ? supabase.from('contracts').select('id,contract_number,name,status,end_date,renewal_notice_days,owner_id').eq('owner_id', actorId).eq('status', 'Active').order('end_date').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('license.view')
      ? supabase.from('software_licenses').select('id,license_code,software_name,status,expire_date,expiry_notice_days,assigned_to').eq('status', 'Active').order('expire_date').limit(100)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('compliance.view')
      ? supabase.from('compliance_corrective_actions').select('id,action_code,title,priority,status,due_date,owner').order('due_date').limit(200)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('risk.view')
      ? supabase.from('governance_risks').select('id,risk_code,title,risk_score,status,due_date,owner,treatment_owner,treatment_plan').order('due_date').limit(200)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('audit_management.view')
      ? supabase.from('audit_findings').select('id,finding_code,title,finding_type,status,due_date,owner').order('due_date').limit(200)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('ticket.update')
      ? supabase.from('tickets').select('id,ticket_no,title,status,priority,due_at').is('assignee_id', null).not('status', 'in', '(เสร็จสิ้น,ปิดงาน,ยกเลิก,ยกระดับเป็น Incident)').order('due_at').limit(50)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('service_request.update')
      ? supabase.from('service_requests').select('id,service_code,summary,service_name,status,priority,due_at').is('assignee_id', null).not('status', 'in', '(ปิดงาน,ปฏิเสธ,ยกเลิก)').order('due_at').limit(50)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('incident.manage')
      ? supabase.from('incidents').select('id,incident_number,title,severity,risk_score,status,dpo_notify_deadline').is('assignee_id', null).not('status', 'eq', 'ปิดเคส').order('dpo_notify_deadline').limit(50)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('problem.manage')
      ? supabase.from('problems').select('id,problem_number,title,priority,status,review_date').is('owner_id', null).not('status', 'eq', 'ปิด').order('review_date').limit(50)
      : Promise.resolve({ data: [], error: null }),
    permissions.has('contract.manage')
      ? supabase.from('contracts').select('id,contract_number,name,status,end_date').is('owner_id', null).eq('status', 'Active').order('end_date').limit(50)
      : Promise.resolve({ data: [], error: null }),
    admin.from('my_work_snoozes').select('work_key,snoozed_until').eq('user_id', actorId),
    admin.from('my_work_saved_views').select('id,name,scope,source_kind,sort_by,updated_at').eq('user_id', actorId).order('updated_at', { ascending: false }).limit(50),
  ]);

  const firstError = ticketsResult.error ?? requestsResult.error ?? tasksResult.error
    ?? accessApprovalsResult.error ?? accessFulfillmentResult.error ?? workflowResult.error ?? groupsResult.error
    ?? ownerProfileResult.error ?? incidentResult.error ?? problemResult.error ?? changeTestResult.error ?? changeApprovalResult.error
    ?? vulnerabilityResult.error ?? backupResult.error ?? recoveryResult.error ?? logSystemResult.error ?? logReviewResult.error
    ?? contractResult.error ?? licenseResult.error ?? capaResult.error ?? riskResult.error ?? findingResult.error
    ?? teamTicketsResult.error ?? teamRequestsResult.error ?? teamIncidentsResult.error ?? teamProblemsResult.error ?? teamContractsResult.error
    ?? snoozesResult.error ?? savedViewsResult.error;
  if (firstError) return dbFailJson(c, 'MY_WORK_LOAD_FAILED', firstError);

  const rawItems: RawMyWorkItem[] = [];
  const addRaw = (item: RawMyWorkItem) => rawItems.push(item);
  for (const row of ticketsResult.data ?? []) addRaw({ id: row.id, kind: 'ticket', source: 'Ticket', title: `${row.ticket_no} · ${row.title}`, status: row.status, priority: row.priority, dueAt: row.due_at, slaPaused: Boolean(row.sla_paused_at), path: `/tickets/${row.id}`, action: 'ดำเนินการ' });
  for (const row of requestsResult.data ?? []) addRaw({ id: row.id, kind: 'service_request', source: 'คำขอบริการ', title: `${row.service_code} · ${row.summary || row.service_name}`, status: row.status, priority: row.priority, dueAt: row.due_at, path: `/service-requests/${row.id}`, action: 'ดำเนินการ' });
  for (const row of tasksResult.data ?? []) addRaw({ id: row.id, kind: 'task', source: 'งานส่วนตัว', title: row.title, status: row.status, priority: row.priority, dueAt: row.due_date, path: '/tasks', action: 'เปิดงาน' });

  const groupIds = (groupsResult.data ?? []).map((row) => row.group_id as string);
  if (groupIds.length && permissions.has('service_request.view')) {
    const { data, error } = await supabase.from('service_requests')
      .select('id,service_code,summary,service_name,status,priority,due_at')
      .eq('status', 'รออนุมัติ').in('approval_group_id', groupIds).order('due_at').limit(100);
    if (error) return dbFailJson(c, 'MY_WORK_SERVICE_APPROVALS_FAILED', error);
    for (const row of data ?? []) addRaw({ id: row.id, kind: 'service_approval', source: 'อนุมัติบริการ', title: `${row.service_code} · ${row.summary || row.service_name}`, status: row.status, priority: row.priority, dueAt: row.due_at, path: `/service-requests/${row.id}`, action: 'พิจารณา' });
  }

  const accessItem = (row: Record<string, unknown>, kind: MyWorkItem['kind'], action: string): RawMyWorkItem => {
    const system = row.access_systems as { name?: string } | null;
    const item = row.access_control_item as { kind?: string; name?: string } | null;
    const itemLabel = item?.name ? `${item.kind?.toUpperCase() ?? 'RBAC'} · ${item.name}` : String(row.access_level ?? '');
    return { id: String(row.id), kind, source: 'คำขอสิทธิ์', title: `${system?.name ?? 'ระบบ'} · ${itemLabel}`, status: String(row.status), priority: null, dueAt: row.review_due ? String(row.review_due) : null, path: `/access-requests/${String(row.id)}`, action };
  };
  for (const row of accessApprovalsResult.data ?? []) addRaw(accessItem(row as unknown as Record<string, unknown>, 'access_approval', 'พิจารณา'));
  for (const row of accessFulfillmentResult.data ?? []) addRaw(accessItem(row as unknown as Record<string, unknown>, 'access_fulfillment', 'ดำเนินการให้สิทธิ์'));
  for (const row of workflowResult.data ?? []) {
    const instance = row.workflow_instances as unknown as { instance_code?: string; record_label?: string } | null;
    addRaw({ id: row.id, kind: 'workflow_approval', source: 'Workflow', title: `${instance?.instance_code ?? ''} · ${instance?.record_label ?? 'งานอนุมัติ'}`.replace(/^ · /, ''), status: row.status, priority: null, dueAt: row.due_at, path: '/workflows', action: 'พิจารณา' });
  }

  const daysFromNow = (value: string | null): number | null => value ? Math.floor((Date.parse(value) - Date.now()) / 86_400_000) : null;
  const nearDue = (value: string | null, threshold: number): boolean => { const days = daysFromNow(value); return days !== null && days <= threshold; };
  for (const row of incidentResult.data ?? []) addRaw({ id: row.id, kind: 'incident', source: 'Incident', title: `${row.incident_number} · ${row.title}`, status: row.status, priority: row.severity, riskScore: numericOrNull(row.risk_score) ?? scoreFromLabel(row.severity), dueAt: row.dpo_notify_deadline, path: `/incidents/${row.id}`, action: 'แก้ไข Incident' });
  for (const row of problemResult.data ?? []) addRaw({ id: row.id, kind: 'problem', source: 'Problem', title: `${row.problem_number} · ${row.title}`, status: row.status, priority: row.priority, dueAt: row.review_date, path: `/problems/${row.id}`, action: 'จัดการ Problem' });
  for (const row of changeTestResult.data ?? []) addRaw({ id: row.id, kind: 'change_test', source: 'Change · รอทดสอบ', title: `${row.change_number} · ${row.title}`, status: row.status, priority: row.risk_level, dueAt: null, path: `/changes/${row.id}`, action: 'ทดสอบ Change' });
  for (const row of changeApprovalResult.data ?? []) addRaw({ id: row.id, kind: 'change_approval', source: 'Change · รออนุมัติ', title: `${row.change_number} · ${row.title}`, status: row.status, priority: row.risk_level, dueAt: null, path: `/changes/${row.id}`, action: 'อนุมัติ Change' });
  for (const row of vulnerabilityResult.data ?? []) addRaw({ id: row.id, kind: 'vulnerability', source: 'Vulnerability', title: `${row.vulnerability_code} · ${row.title}`, status: row.status, priority: row.severity, riskScore: numericOrNull(row.cvss) ?? scoreFromLabel(row.severity), dueAt: row.due_date, path: `/vulnerabilities/${row.id}`, action: 'แก้ไขช่องโหว่' });
  for (const row of backupResult.data ?? []) if (nearDue(row.next_backup_due, 30)) addRaw({ id: row.id, kind: 'backup', source: 'Backup', title: `${row.backup_code} · ${row.system_name}`, status: row.result, priority: /ล้มเหลว/i.test(String(row.result)) ? 'สูง' : null, riskScore: /ล้มเหลว/i.test(String(row.result)) ? 16 : null, dueAt: row.next_backup_due, path: '/backup-monitoring', action: 'ตรวจ Backup' });
  for (const row of recoveryResult.data ?? []) if (nearDue(row.next_test_due, 30)) addRaw({ id: row.id, kind: 'recovery_test', source: 'Recovery Test', title: `${row.recovery_code} · ${row.system_name}`, status: row.result, priority: /ไม่ผ่าน/i.test(String(row.result)) ? 'สูง' : null, riskScore: /ไม่ผ่าน/i.test(String(row.result)) ? 16 : null, dueAt: row.next_test_due, path: '/backup-monitoring', action: 'วางแผนทดสอบ' });
  for (const row of logSystemResult.data ?? []) if (nearDue(row.next_review_due, 30)) addRaw({ id: row.id, kind: 'log_review', source: 'Log Review', title: `${row.log_system_code} · ${row.system_name}`, status: row.status, priority: null, dueAt: row.next_review_due, path: '/backup-monitoring', action: 'ตรวจ Log' });
  for (const row of logReviewResult.data ?? []) if (row.anomaly_found || row.status !== 'ปกติ') addRaw({ id: row.id, kind: 'log_review', source: 'Log Review · Finding', title: `${row.review_code} · ${row.period}`, status: row.status, priority: 'สูง', dueAt: null, path: '/backup-monitoring', action: 'ติดตาม Finding' });
  for (const row of contractResult.data ?? []) if (nearDue(row.end_date, Number(row.renewal_notice_days ?? 30))) addRaw({ id: row.id, kind: 'contract_renewal', source: 'Contract Renewal', title: `${row.contract_number} · ${row.name}`, status: row.status, priority: null, dueAt: row.end_date, path: '/vendors-contracts', action: 'ต่ออายุสัญญา' });
  for (const row of licenseResult.data ?? []) if (nearDue(row.expire_date, Number(row.expiry_notice_days ?? 30))) addRaw({ id: row.id, kind: 'license_renewal', source: 'License Renewal', title: `${row.license_code ?? 'LIC'} · ${row.software_name}`, status: row.status, priority: null, dueAt: row.expire_date, path: '/software-licenses', action: 'ต่ออายุ License' });
  for (const row of capaResult.data ?? []) if (workOwnerMatches(row, ['owner'], ownerTokens) && row.status !== 'ปิด') addRaw({ id: row.id, kind: 'governance_capa', source: 'Governance CAPA', title: `${row.action_code} · ${row.title}`, status: row.status, priority: row.priority, dueAt: row.due_date, path: '/governance', action: 'ดำเนินการ CAPA' });
  for (const row of riskResult.data ?? []) if (workOwnerMatches(row, ['owner', 'treatment_owner'], ownerTokens) && row.status !== 'ปิด') addRaw({ id: row.id, kind: 'risk_treatment', source: 'Risk Treatment', title: `${row.risk_code} · ${row.title}`, status: row.status, priority: String(row.risk_score ?? ''), riskScore: numericOrNull(row.risk_score), dueAt: row.due_date, path: '/governance', action: 'จัดการ Risk' });
  for (const row of findingResult.data ?? []) if (workOwnerMatches(row, ['owner'], ownerTokens) && row.status !== 'ปิด') addRaw({ id: row.id, kind: 'audit_finding', source: 'Audit Finding', title: `${row.finding_code} · ${row.title}`, status: row.status, priority: row.finding_type, dueAt: row.due_date, path: '/governance', action: 'แก้ Audit Finding' });

  const snoozeMap = new Map<string, string>((snoozesResult.data ?? []).map((row) => [String(row.work_key), String(row.snoozed_until)]));
  const now = Date.now();
  const hydratedItems: MyWorkItem[] = rawItems.map((item) => {
    const dueAt = item.dueAt ? String(item.dueAt) : null;
    const remaining = dueAt ? Math.round((Date.parse(dueAt) - now) / 1000) : null;
    const snoozed = snoozeMap.get(workKey(item.kind, item.id));
    const activeSnooze = snoozed && Date.parse(snoozed) > now ? snoozed : null;
    const sla = itemSlaState(dueAt, Boolean(item.slaPaused), now);
    return { ...item, riskScore: item.riskScore ?? riskScore(item as unknown as Row, ['priority']) ?? scoreFromLabel(item.priority), slaState: sla, slaRemainingSeconds: remaining, isOverdue: sla === 'overdue', snoozedUntil: activeSnooze };
  });
  hydratedItems.sort(itemSort);
  const visibleItems = hydratedItems.filter((item) => !item.snoozedUntil);

  const teamQueue: MyWorkQueueItem[] = [];
  const addQueue = (item: MyWorkQueueItem) => teamQueue.push(item);
  for (const row of teamTicketsResult.data ?? []) addQueue({ id: row.id, kind: 'ticket', source: 'Ticket Queue', title: `${row.ticket_no} · ${row.title}`, status: row.status, priority: row.priority, dueAt: row.due_at, riskScore: scoreFromLabel(row.priority), path: `/tickets/${row.id}` });
  for (const row of teamRequestsResult.data ?? []) addQueue({ id: row.id, kind: 'service_request', source: 'Service Queue', title: `${row.service_code} · ${row.summary || row.service_name}`, status: row.status, priority: row.priority, dueAt: row.due_at, riskScore: scoreFromLabel(row.priority), path: `/service-requests/${row.id}` });
  for (const row of teamIncidentsResult.data ?? []) addQueue({ id: row.id, kind: 'incident', source: 'Incident Queue', title: `${row.incident_number} · ${row.title}`, status: row.status, priority: row.severity, dueAt: row.dpo_notify_deadline, riskScore: numericOrNull(row.risk_score) ?? scoreFromLabel(row.severity), path: `/incidents/${row.id}` });
  for (const row of teamProblemsResult.data ?? []) addQueue({ id: row.id, kind: 'problem', source: 'Problem Queue', title: `${row.problem_number} · ${row.title}`, status: row.status, priority: row.priority, dueAt: row.review_date, riskScore: scoreFromLabel(row.priority), path: `/problems/${row.id}` });
  for (const row of teamContractsResult.data ?? []) addQueue({ id: row.id, kind: 'contract_renewal', source: 'Contract Queue', title: `${row.contract_number} · ${row.name}`, status: row.status, priority: null, dueAt: row.end_date, riskScore: null, path: '/vendors-contracts' });
  teamQueue.sort(queueSort);

  const savedViews: MyWorkSavedView[] = (savedViewsResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name), scope: String(row.scope), sourceKind: row.source_kind ? String(row.source_kind) : null, sortBy: String(row.sort_by), updatedAt: String(row.updated_at) }));
  return c.json(ok(requestId, {
    items: visibleItems,
    snoozedItems: hydratedItems.filter((item) => Boolean(item.snoozedUntil)).map((item) => ({ id: item.id, kind: item.kind, title: item.title, snoozedUntil: item.snoozedUntil })),
    teamQueue,
    savedViews,
    summary: {
      total: visibleItems.length,
      overdue: hydratedItems.filter((item) => item.isOverdue && !item.slaPaused).length,
      approvals: visibleItems.filter((item) => ['service_approval', 'access_approval', 'workflow_approval', 'change_test', 'change_approval'].includes(item.kind)).length,
      assigned: visibleItems.filter((item) => ['ticket', 'service_request', 'access_fulfillment', 'incident', 'problem', 'vulnerability'].includes(item.kind)).length,
      snoozed: hydratedItems.filter((item) => Boolean(item.snoozedUntil)).length,
      teamQueue: teamQueue.length,
    },
    generatedAt: new Date().toISOString(),
  }));
});

dashboardRoute.post('/my-work/saved-views', zValidator('json', myWorkSavedViewSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).from('my_work_saved_views').upsert({
    user_id: actorId, name: body.name, scope: body.scope, source_kind: body.sourceKind || null, sort_by: body.sortBy, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,name' }).select('id,name,scope,source_kind,sort_by,updated_at').single();
  if (error) return dbFailJson(c, 'MY_WORK_SAVED_VIEW_FAILED', error);
  return c.json(ok(requestId, { id: data.id, name: data.name, scope: data.scope, sourceKind: data.source_kind, sortBy: data.sort_by, updatedAt: data.updated_at }), 201);
});

dashboardRoute.delete('/my-work/saved-views/:id', async (c) => {
  const requestId = c.get('requestId');
  const actorId = c.get('userId');
  const { error } = await createAdminClient(c.env).from('my_work_saved_views').delete().eq('id', c.req.param('id')!).eq('user_id', actorId);
  if (error) return dbFailJson(c, 'MY_WORK_SAVED_VIEW_DELETE_FAILED', error);
  return c.json(ok(requestId, { deleted: true }));
});

dashboardRoute.post('/my-work/:kind/:id/snooze', zValidator('json', myWorkSnoozeSchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const actorId = c.get('userId');
  const kind = c.req.param('kind') ?? '';
  const id = c.req.param('id') ?? '';
  if (!validWorkKind(kind) || !id || id.length > 100) return c.json(fail(requestId, 'MY_WORK_KIND_INVALID', 'ประเภทงานไม่ถูกต้อง'), 400);
  const { minutes } = c.req.valid('json');
  const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
  const { error } = await createAdminClient(c.env).from('my_work_snoozes').upsert({ user_id: actorId, work_key: workKey(kind, id), snoozed_until: snoozedUntil }, { onConflict: 'user_id,work_key' });
  if (error) return dbFailJson(c, 'MY_WORK_SNOOZE_FAILED', error);
  return c.json(ok(requestId, { kind, id, snoozedUntil }));
});

dashboardRoute.delete('/my-work/:kind/:id/snooze', async (c) => {
  const requestId = c.get('requestId');
  const actorId = c.get('userId');
  const kind = c.req.param('kind') ?? '';
  const id = c.req.param('id') ?? '';
  if (!validWorkKind(kind) || !id || id.length > 100) return c.json(fail(requestId, 'MY_WORK_KIND_INVALID', 'ประเภทงานไม่ถูกต้อง'), 400);
  const { error } = await createAdminClient(c.env).from('my_work_snoozes').delete().eq('user_id', actorId).eq('work_key', workKey(kind, id));
  if (error) return dbFailJson(c, 'MY_WORK_UNSNOOZE_FAILED', error);
  return c.json(ok(requestId, { kind, id, snoozed: false }));
});

dashboardRoute.post('/my-work/team-queue/:kind/:id/claim', async (c) => {
  const requestId = c.get('requestId');
  const actorId = c.get('userId');
  const kind = c.req.param('kind') ?? '';
  const id = c.req.param('id') ?? '';
  const claims: Record<string, { table: string; field: string; permission: string }> = {
    ticket: { table: 'tickets', field: 'assignee_id', permission: 'ticket.update' },
    service_request: { table: 'service_requests', field: 'assignee_id', permission: 'service_request.update' },
    incident: { table: 'incidents', field: 'assignee_id', permission: 'incident.manage' },
    problem: { table: 'problems', field: 'owner_id', permission: 'problem.manage' },
    contract_renewal: { table: 'contracts', field: 'owner_id', permission: 'contract.manage' },
  };
  const target = claims[kind];
  if (!target || !id || id.length > 100) return c.json(fail(requestId, 'MY_WORK_CLAIM_INVALID', 'ประเภทคิวงานไม่ถูกต้อง'), 400);
  const { data: permission } = await c.get('supabase').rpc('has_permission', { permission_key_input: target.permission });
  if (permission !== true) return c.json(fail(requestId, 'MY_WORK_CLAIM_FORBIDDEN', 'ไม่มีสิทธิ์รับงานประเภทนี้'), 403);
  const update = { [target.field]: actorId, updated_by: actorId } as Record<string, unknown>;
  const { data, error } = await createAdminClient(c.env).from(target.table).update(update).eq('id', id).is(target.field, null).select('id').maybeSingle();
  if (error) return dbFailJson(c, 'MY_WORK_CLAIM_FAILED', error);
  if (!data) return c.json(fail(requestId, 'MY_WORK_ALREADY_CLAIMED', 'งานนี้ถูกรับไปแล้วหรือไม่อยู่ในคิว'), 409);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CLAIM', module: 'my-work', targetTable: target.table, targetId: id, detail: { kind }, requestId });
  return c.json(ok(requestId, { claimed: true, kind, id, assigneeId: actorId }));
});

dashboardRoute.get('/summary', zValidator('query', dashboardSummaryQuerySchema, zodValidationHook), async (c) => {
  const requestId = c.get('requestId');
  const { leadDays } = c.req.valid('query');
  const supabase = c.get('supabase');
  const [permissionResult, roleResult] = await Promise.all([supabase.rpc('my_permissions'), supabase.rpc('my_roles')]);
  if (permissionResult.error || roleResult.error) {
    return dbFailJson(c, 'DASHBOARD_ACCESS_LOAD_FAILED', permissionResult.error ?? roleResult.error, 'โหลดสิทธิ์ไม่สำเร็จ');
  }

  const permissions = new Set((permissionResult.data ?? []).map((row: { permission_key: string }) => row.permission_key));
  const roles = (roleResult.data ?? []).map((row: { role_key: string }) => row.role_key);
  const allowed = SOURCES.filter((source) => permissions.has(source.permission));
  const mode = modeFor(roles);
  const actorId = c.get('userId');
  const loaded = await Promise.all(allowed.map((source) => loadSource(supabase, source, mode, actorId)));
  const sourceError = loaded.find((item) => item.error)?.error;
  if (sourceError) return dbFailJson(c, 'DASHBOARD_SUMMARY_LOAD_FAILED', sourceError);

  const dueItems: Array<{ id: string; source: string; title: string; status: string; dueAt: string; daysRemaining: number; tone: Tone; path: string }> = [];
  const cards = loaded.filter(({ source }) => source.key !== 'tasks').map(({ source, rows, total, truncated }) => {
    let overdue = 0;
    let warning = 0;
    let paused = 0;
    for (const row of rows) {
      if (source.terminal(row)) continue;
      const ticketSla = source.key === 'tickets' ? ticketSlaState(row) : null;
      if (source.paused?.(row) || ticketSla === 'paused') { paused += 1; continue; }
      const remaining = daysUntil(source.due(row));
      const flagged = source.warning?.(row) ?? false;
      const isOverdue = ticketSla === 'overdue' || (ticketSla === null && remaining !== null && remaining < 0);
      const isWarning = ticketSla === 'due_soon' || flagged || (remaining !== null && remaining <= leadDays);
      if (isOverdue) overdue += 1;
      else if (isWarning) warning += 1;
      if (remaining !== null && remaining <= leadDays) dueItems.push({ id: text(row, 'id'), source: source.label, title: source.title(row), status: source.status(row), dueAt: source.due(row)!, daysRemaining: remaining, tone: isOverdue ? 'danger' : remaining <= 7 ? 'amber' : 'primary', path: source.path });
    }
    // total มาจาก count ของฐานข้อมูล ส่วน warning/overdue นับจากแถวที่สแกนจริง — truncated บอกผู้ใช้
    // ตรง ๆ เมื่อสองค่านี้มาจากฐานคนละขนาด แทนที่จะแสดงตัวเลขที่ต่ำกว่าความจริงอย่างเงียบ ๆ
    return { key: source.key, label: source.label, path: source.path, total, warning, overdue, paused, truncated, scanned: rows.length, tone: toneFor(total - paused, warning, overdue) };
  });

  const byKey = new Map(loaded.map((item) => [item.source.key, item.rows]));
  const open = (key: string) => (byKey.get(key) ?? []).filter((row) => !SOURCES.find((source) => source.key === key)!.terminal(row));
  const overdue = (key: string) => open(key).filter((row) => key === 'tickets'
    ? ticketSlaState(row) === 'overdue'
    : (daysUntil(SOURCES.find((source) => source.key === key)!.due(row)) ?? 1) < 0).length;
  const tickets = open('tickets');
  const requests = open('service-requests');
  const tasks = open('tasks');
  const incidents = open('incidents');
  const personalDataIncidents = incidents.filter((row) => Boolean(row.contains_personal_data));
  const criticalIncidents = incidents.filter((row) => /สูง|วิกฤต|critical|high/i.test(text(row, 'severity')));
  const actionableCards = cards.filter((card) => card.tone !== 'gray');
  const healthyCards = actionableCards.filter((card) => card.tone === 'teal').length;
  const healthPercent = actionableCards.length ? Math.round(healthyCards / actionableCards.length * 100) : 100;
  const totalOverdue = cards.reduce((sum, card) => sum + card.overdue, 0) + overdue('tasks');

  const metricsByMode: Record<ViewMode, Array<{ key: string; label: string; value: number | string; note: string; tone: Tone; path?: string }>> = {
    executive: [
      { key: 'critical-incidents', label: 'เหตุการณ์สำคัญที่เปิดอยู่', value: criticalIncidents.length, note: 'Incident ระดับสูง/วิกฤต', tone: criticalIncidents.length ? 'danger' : 'teal', path: dashboardPath('/incidents', leadDays, { status: 'เปิด' }) },
      { key: 'control-health', label: 'สุขภาพมาตรการควบคุม', value: `${healthPercent}%`, note: 'เชิงปฏิบัติการจากข้อมูลที่เข้าถึงได้', tone: healthPercent < 70 ? 'danger' : healthPercent < 90 ? 'amber' : 'teal' },
      { key: 'overdue-items', label: 'รายการเกินกำหนด', value: totalOverdue, note: 'รวมทุกโมดูลที่เข้าถึงได้', tone: totalOverdue ? 'danger' : 'teal', path: dashboardPath('/my-work', leadDays) },
      { key: 'open-service-requests', label: 'คำขอบริการที่เปิดอยู่', value: requests.length, note: `${overdue('service-requests')} รายการเกินกำหนด`, tone: overdue('service-requests') ? 'danger' : requests.length ? 'amber' : 'teal', path: dashboardPath('/service-requests', leadDays, { tab: 'all' }) },
    ],
    privacy: [
      { key: 'personal-data-incidents', label: 'Incident ข้อมูลส่วนบุคคล', value: personalDataIncidents.length, note: 'รายการที่ยังไม่ปิด', tone: personalDataIncidents.length ? 'danger' : 'teal', path: dashboardPath('/incidents', leadDays, { status: 'เปิด', personalData: 'true' }) },
      { key: 'overdue-dpo-deadlines', label: 'เส้นตายแจ้ง DPO เกินกำหนด', value: personalDataIncidents.filter((row) => (daysUntil(date(row, 'dpo_notify_deadline')) ?? 1) < 0).length, note: 'คำนวณจากเคสที่มองเห็นได้', tone: personalDataIncidents.some((row) => (daysUntil(date(row, 'dpo_notify_deadline')) ?? 1) < 0) ? 'danger' : 'teal', path: dashboardPath('/incidents', leadDays, { status: 'เปิด', personalData: 'true' }) },
      { key: 'open-incidents', label: 'Incident ที่เปิดอยู่', value: incidents.length, note: `${criticalIncidents.length} รายการระดับสูง/วิกฤต`, tone: criticalIncidents.length ? 'danger' : incidents.length ? 'amber' : 'teal', path: dashboardPath('/incidents', leadDays, { status: 'เปิด' }) },
      { key: 'my-tasks', label: 'งานของฉัน', value: tasks.length, note: `${overdue('tasks')} งานเกินกำหนด`, tone: overdue('tasks') ? 'danger' : tasks.length ? 'primary' : 'teal', path: dashboardPath('/tasks', leadDays, { scope: 'focus' }) },
    ],
    operations: [
      { key: 'open-tickets', label: 'Ticket ที่เปิดอยู่', value: tickets.length, note: `${overdue('tickets')} รายการเกิน SLA/กำหนด`, tone: overdue('tickets') ? 'danger' : tickets.length ? 'amber' : 'teal', path: dashboardPath('/tickets', leadDays) },
      { key: 'open-requests', label: 'คำขอบริการที่เปิดอยู่', value: requests.length, note: `${overdue('service-requests')} รายการเกินกำหนด`, tone: overdue('service-requests') ? 'danger' : requests.length ? 'amber' : 'teal', path: dashboardPath('/service-requests', leadDays, { tab: 'all' }) },
      { key: 'assigned-tasks', label: 'งานของฉัน', value: tasks.length, note: `${overdue('tasks')} งานเกินกำหนด`, tone: overdue('tasks') ? 'danger' : tasks.length ? 'primary' : 'teal', path: dashboardPath('/tasks', leadDays, { scope: 'focus' }) },
      { key: 'open-incidents-operations', label: 'Incident ที่เปิดอยู่', value: incidents.length, note: `${criticalIncidents.length} รายการระดับสูง/วิกฤต`, tone: criticalIncidents.length ? 'danger' : incidents.length ? 'amber' : 'teal', path: dashboardPath('/incidents', leadDays, { status: 'เปิด' }) },
    ],
    personal: [
      { key: 'my-tickets', label: 'Ticket ของฉัน', value: tickets.length, note: `${overdue('tickets')} รายการเกินกำหนด`, tone: overdue('tickets') ? 'danger' : tickets.length ? 'primary' : 'teal', path: dashboardPath('/tickets', leadDays, { mine: 'true' }) },
      { key: 'my-service-requests', label: 'คำขอบริการของฉัน', value: requests.length, note: `${overdue('service-requests')} รายการเกินกำหนด`, tone: overdue('service-requests') ? 'danger' : requests.length ? 'primary' : 'teal', path: dashboardPath('/service-requests', leadDays, { mine: 'true', tab: 'mine' }) },
      { key: 'my-personal-tasks', label: 'งานของฉัน', value: tasks.length, note: `${overdue('tasks')} งานเกินกำหนด`, tone: overdue('tasks') ? 'danger' : tasks.length ? 'primary' : 'teal', path: dashboardPath('/tasks', leadDays, { scope: 'focus' }) },
      { key: 'due-soon-items', label: 'รายการใกล้ครบกำหนด', value: dueItems.filter((item) => item.daysRemaining >= 0).length, note: `ภายใน ${leadDays} วัน`, tone: dueItems.some((item) => item.daysRemaining >= 0) ? 'amber' : 'teal', path: dashboardPath('/my-work', leadDays) },
    ],
  };

  const ticketSource = loaded.find((item) => item.source.key === 'tickets');
  const executiveAnalytics = ticketSource && ['executive', 'operations'].includes(mode)
    ? buildExecutiveServiceAnalytics({ tickets: ticketSource.rows, periodDays: leadDays, sampled: ticketSource.truncated })
    : null;
  const decisions: DashboardDecision[] = mode === 'executive'
    ? [
      ...criticalIncidents.map((row) => ({
        id: text(row, 'id'),
        source: 'Incident',
        title: `${text(row, 'incident_number')} · ${text(row, 'title')}`.replace(/^ · /, ''),
        reason: 'Incident ระดับสูง/วิกฤต ต้องกำกับการตอบสนอง',
        path: dashboardPath(`/incidents/${text(row, 'id')}`, leadDays),
      })),
      ...tickets.filter((row) => text(row, 'priority') === 'วิกฤต').map((row) => ({
        id: text(row, 'id'),
        source: 'Ticket',
        title: `${text(row, 'ticket_no')} · ${text(row, 'title')}`.replace(/^ · /, ''),
        reason: 'Ticket วิกฤต ต้องตัดสินใจเรื่องทรัพยากรหรือการยกระดับ',
        path: dashboardPath(`/tickets/${text(row, 'id')}`, leadDays),
      })),
    ].slice(0, 8)
    : [];
  const countValues = (rows: Row[], field: string) => [...rows.reduce((map, row) => { const label = text(row, field) || 'ไม่ระบุ'; map.set(label, (map.get(label) ?? 0) + 1); return map; }, new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const trend = dashboardTrend(loaded);
  return c.json(ok(requestId, {
    mode,
    metrics: metricsByMode[mode],
    cards: cards.map((card) => ({ ...card, path: dashboardPath(card.path, leadDays) })),
    upcoming: dueItems.sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 30).map((item) => ({ ...item, path: dashboardPath(item.path, leadDays) })),
    breakdowns: [
      { key: 'ticket-priority', label: 'Ticket ตามความสำคัญ', items: countValues(byKey.get('tickets') ?? [], 'priority') },
      { key: 'incident-severity', label: 'Incident ตามความรุนแรง', items: countValues(byKey.get('incidents') ?? [], 'severity') },
    ],
    executiveAnalytics,
    decisions,
    trend,
    alertCount: totalOverdue + criticalIncidents.length,
    leadDays,
    generatedAt: new Date().toISOString(),
  }));
});
