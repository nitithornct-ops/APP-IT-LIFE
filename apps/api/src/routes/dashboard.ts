import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { dashboardSummaryQuerySchema } from '../validators/dashboard';

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
  { key: 'tickets', label: 'Ticket', permission: 'ticket.view', table: 'tickets', select: 'id,title,status,priority,due_at,requester_id,assignee_id,created_at', path: '/tickets', title: (r) => text(r, 'title'), status: (r) => text(r, 'status'), due: (r) => date(r, 'due_at'), terminal: (r) => TERMINAL_TICKET.has(text(r, 'status')) },
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
    for (const row of rows) {
      if (source.terminal(row)) continue;
      const remaining = daysUntil(source.due(row));
      const flagged = source.warning?.(row) ?? false;
      if (remaining !== null && remaining < 0) overdue += 1;
      else if (flagged || (remaining !== null && remaining <= leadDays)) warning += 1;
      if (remaining !== null && remaining <= leadDays) dueItems.push({ id: text(row, 'id'), source: source.label, title: source.title(row), status: source.status(row), dueAt: source.due(row)!, daysRemaining: remaining, tone: remaining < 0 ? 'danger' : remaining <= 7 ? 'amber' : 'primary', path: source.path });
    }
    // total มาจาก count ของฐานข้อมูล ส่วน warning/overdue นับจากแถวที่สแกนจริง — truncated บอกผู้ใช้
    // ตรง ๆ เมื่อสองค่านี้มาจากฐานคนละขนาด แทนที่จะแสดงตัวเลขที่ต่ำกว่าความจริงอย่างเงียบ ๆ
    return { key: source.key, label: source.label, path: source.path, total, warning, overdue, truncated, scanned: rows.length, tone: toneFor(total, warning, overdue) };
  });

  const byKey = new Map(loaded.map((item) => [item.source.key, item.rows]));
  const open = (key: string) => (byKey.get(key) ?? []).filter((row) => !SOURCES.find((source) => source.key === key)!.terminal(row));
  const overdue = (key: string) => open(key).filter((row) => (daysUntil(SOURCES.find((source) => source.key === key)!.due(row)) ?? 1) < 0).length;
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

  const metricsByMode: Record<ViewMode, Array<{ label: string; value: number | string; note: string; tone: Tone; path?: string }>> = {
    executive: [
      { label: 'เหตุการณ์สำคัญที่เปิดอยู่', value: criticalIncidents.length, note: 'Incident ระดับสูง/วิกฤต', tone: criticalIncidents.length ? 'danger' : 'teal', path: '/incidents' },
      { label: 'สุขภาพมาตรการควบคุม', value: `${healthPercent}%`, note: 'เชิงปฏิบัติการจากข้อมูลที่เข้าถึงได้', tone: healthPercent < 70 ? 'danger' : healthPercent < 90 ? 'amber' : 'teal' },
      { label: 'รายการเกินกำหนด', value: totalOverdue, note: 'รวมทุกโมดูลที่เข้าถึงได้', tone: totalOverdue ? 'danger' : 'teal' },
      { label: 'คำขอบริการที่เปิดอยู่', value: requests.length, note: `${overdue('service-requests')} รายการเกินกำหนด`, tone: overdue('service-requests') ? 'danger' : requests.length ? 'amber' : 'teal', path: '/service-requests' },
    ],
    privacy: [
      { label: 'Incident ข้อมูลส่วนบุคคล', value: personalDataIncidents.length, note: 'รายการที่ยังไม่ปิด', tone: personalDataIncidents.length ? 'danger' : 'teal', path: '/incidents' },
      { label: 'เส้นตายแจ้ง DPO เกินกำหนด', value: personalDataIncidents.filter((row) => (daysUntil(date(row, 'dpo_notify_deadline')) ?? 1) < 0).length, note: 'คำนวณจากเคสที่มองเห็นได้', tone: personalDataIncidents.some((row) => (daysUntil(date(row, 'dpo_notify_deadline')) ?? 1) < 0) ? 'danger' : 'teal', path: '/incidents' },
      { label: 'Incident ที่เปิดอยู่', value: incidents.length, note: `${criticalIncidents.length} รายการระดับสูง/วิกฤต`, tone: criticalIncidents.length ? 'danger' : incidents.length ? 'amber' : 'teal', path: '/incidents' },
      { label: 'งานของฉัน', value: tasks.length, note: `${overdue('tasks')} งานเกินกำหนด`, tone: overdue('tasks') ? 'danger' : tasks.length ? 'primary' : 'teal', path: '/tasks' },
    ],
    operations: [
      { label: 'Ticket ที่เปิดอยู่', value: tickets.length, note: `${overdue('tickets')} รายการเกิน SLA/กำหนด`, tone: overdue('tickets') ? 'danger' : tickets.length ? 'amber' : 'teal', path: '/tickets' },
      { label: 'คำขอบริการที่เปิดอยู่', value: requests.length, note: `${overdue('service-requests')} รายการเกินกำหนด`, tone: overdue('service-requests') ? 'danger' : requests.length ? 'amber' : 'teal', path: '/service-requests' },
      { label: 'งานของฉัน', value: tasks.length, note: `${overdue('tasks')} งานเกินกำหนด`, tone: overdue('tasks') ? 'danger' : tasks.length ? 'primary' : 'teal', path: '/tasks' },
      { label: 'Incident ที่เปิดอยู่', value: incidents.length, note: `${criticalIncidents.length} รายการระดับสูง/วิกฤต`, tone: criticalIncidents.length ? 'danger' : incidents.length ? 'amber' : 'teal', path: '/incidents' },
    ],
    personal: [
      { label: 'Ticket ของฉัน', value: tickets.length, note: `${overdue('tickets')} รายการเกินกำหนด`, tone: overdue('tickets') ? 'danger' : tickets.length ? 'primary' : 'teal', path: '/tickets' },
      { label: 'คำขอบริการของฉัน', value: requests.length, note: `${overdue('service-requests')} รายการเกินกำหนด`, tone: overdue('service-requests') ? 'danger' : requests.length ? 'primary' : 'teal', path: '/service-requests' },
      { label: 'งานของฉัน', value: tasks.length, note: `${overdue('tasks')} งานเกินกำหนด`, tone: overdue('tasks') ? 'danger' : tasks.length ? 'primary' : 'teal', path: '/tasks' },
      { label: 'รายการใกล้ครบกำหนด', value: dueItems.filter((item) => item.daysRemaining >= 0).length, note: `ภายใน ${leadDays} วัน`, tone: dueItems.some((item) => item.daysRemaining >= 0) ? 'amber' : 'teal' },
    ],
  };

  const countValues = (rows: Row[], field: string) => [...rows.reduce((map, row) => { const label = text(row, field) || 'ไม่ระบุ'; map.set(label, (map.get(label) ?? 0) + 1); return map; }, new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  return c.json(ok(requestId, {
    mode,
    metrics: metricsByMode[mode],
    cards,
    upcoming: dueItems.sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 30),
    breakdowns: [
      { key: 'ticket-priority', label: 'Ticket ตามความสำคัญ', items: countValues(byKey.get('tickets') ?? [], 'priority') },
      { key: 'incident-severity', label: 'Incident ตามความรุนแรง', items: countValues(byKey.get('incidents') ?? [], 'severity') },
    ],
    alertCount: totalOverdue + criticalIncidents.length,
    leadDays,
    generatedAt: new Date().toISOString(),
  }));
});
