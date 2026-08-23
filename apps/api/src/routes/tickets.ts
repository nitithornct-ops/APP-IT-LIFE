import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { calculateTicketOverallRating, type TicketRatingDetails } from '@itlife/shared';
import { Hono } from 'hono';
import { resolveTicketRequesterLineTarget, sendLinePush } from '../lib/lineMessaging';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import { createSignedUrl } from '../services/storageService';
import { addTicketBusinessHours, parseTicketBusinessCalendar } from '../services/ticketSlaService';
import {
  TICKET_STATUS,
  applyStatusChange,
  assertTransition,
  changesSlaPause,
  fieldOutcomesFor,
} from '../services/ticketWorkflow';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { BulkItemError, runBulk } from '../utils/bulk';
import { checkExportSize, exportFileName, listCsv, LIST_EXPORT_MAX_ROWS, type ExportColumn } from '../utils/listExport';
import { applySort } from '../utils/sort';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { verifyFileSignature } from '../utils/fileSignature';
import { zodValidationHook } from '../utils/validation';
import { addTicketConversationSchema, bulkUpdateTicketsSchema, createTicketSchema, listTicketsQuerySchema, submitTicketFeedbackSchema, updateTicketSchema } from '../validators/tickets';

/**
 * Help Desk / Ticket — สืบทอดจาก Tickets/Ticket_Worklogs เดิม (Module_Ticket.gs) เฉพาะเส้นทาง
 * ผู้ใช้ที่ login ผ่าน Supabase Auth แล้ว — เส้นทางแจ้งซ่อมสาธารณะผ่าน LINE อยู่ที่ routes/line.ts
 * แยกกันเพราะผู้ใช้ LINE ไม่มี Supabase JWT (ดู R-11, ตัดสินใจแล้ว 2026-08-10)
 * SLA due date ใช้เวลาทำการ Asia/Bangkok ตาม Settings เดียวกับ Legacy
 */
export const ticketsRoute = new Hono<AppEnv>();
ticketsRoute.use('*', requireAuth);

const TICKET_SIGNATURE_BUCKET = 'ticket-signatures';
const TICKET_FORM_SIGNATURE_KEY = 'TICKET_FORM_SIGNATURE_PATH';
const MAX_TICKET_SIGNATURE_BYTES = 2 * 1024 * 1024;

export function ratingsMatchCriteria(ratings: TicketRatingDetails, criterionKeys: string[]): boolean {
  const submittedKeys = Object.keys(ratings).sort();
  const expectedKeys = [...criterionKeys].sort();
  return submittedKeys.length === expectedKeys.length
    && submittedKeys.every((key, index) => key === expectedKeys[index]);
}

async function loadActiveRatingCriteria(client: ReturnType<typeof createAdminClient>) {
  return client
    .from('ticket_rating_criteria')
    .select('id, key, label, description, sort_order, status')
    .eq('status', 'active')
    .order('sort_order')
    .order('created_at');
}

async function hasPerm(c: Context<AppEnv>, permissionKey: string): Promise<boolean> {
  const { data, error } = await c.get('supabase').rpc('has_permission', { permission_key_input: permissionKey });
  return !error && data === true;
}

async function loadTicketBusinessCalendar(c: Context<AppEnv>) {
  const keys = ['SLA_BUSINESS_START', 'SLA_BUSINESS_END', 'SLA_BUSINESS_DAYS', 'SLA_HOLIDAYS'];
  const { data } = await createAdminClient(c.env).from('system_settings').select('key, value').in('key', keys);
  return parseTicketBusinessCalendar(Object.fromEntries((data ?? []).map((row) => [row.key, row.value])));
}

/**
 * คอลัมน์ที่ยอมให้เรียงได้ — ไม่รวม priority/status เพราะทั้งคู่เก็บเป็นข้อความไทย
 * การเรียงจะได้ลำดับตามตัวอักษร ไม่ใช่ระดับความเร่งด่วนหรือลำดับ workflow ซึ่งทำให้ผู้ใช้เข้าใจผิด
 */
const TICKET_SORT_COLUMNS = ['ticket_no', 'title', 'due_at', 'created_at'] as const;

/** ส่วนของ query builder ที่ตัวกรองรายการ Ticket ต้องใช้ */
interface TicketFilterableQuery {
  eq(column: string, value: unknown): TicketFilterableQuery;
  or(filters: string): TicketFilterableQuery;
}

interface TicketListFilters {
  status?: string;
  categoryId?: string;
  priority?: string;
  search?: string;
  assigneeId?: string;
  mine?: string;
}

/**
 * ตัวกรองของรายการ Ticket — ใช้ร่วมกันระหว่างการแสดงผลกับการส่งออก
 *
 * ต้องเป็นตัวเดียวกันเท่านั้น ไม่งั้นไฟล์ที่ส่งออกจะมีข้อมูลไม่ตรงกับที่ผู้ใช้เห็นบนหน้าจอ
 * ซึ่งเป็นความผิดพลาดที่ตรวจจับยากมากเพราะไฟล์ก็ยัง "ดูปกติ"
 *
 * RLS (tickets_select_participant_or_staff) เป็นตัวกรองสิทธิ์การมองเห็นจริง — ที่นี่เป็นแค่ UX
 */
function applyTicketListFilters<T>(
  query: T,
  { status, categoryId, priority, search, assigneeId, mine }: TicketListFilters,
  actorId: string,
): T {
  // มอง builder เป็นโครงแคบ ๆ เฉพาะสอง method ที่ใช้ เพราะ generic เต็มของ supabase-js
  // ซ้อนลึกจน TypeScript ยอมแพ้เมื่อเอามาผูกกับ generic ที่อ้างถึงตัวเอง
  let next = query as unknown as TicketFilterableQuery;
  if (status) next = next.eq('status', status);
  if (categoryId) next = next.eq('category_id', categoryId);
  if (priority) next = next.eq('priority', priority);
  if (search) {
    const safeSearch = cleanSearch(search);
    if (safeSearch) {
      next = next.or(
        `ticket_no.ilike.%${safeSearch}%,title.ilike.%${safeSearch}%,requester_name_snapshot.ilike.%${safeSearch}%,department_name_snapshot.ilike.%${safeSearch}%`,
      );
    }
  }
  if (assigneeId) next = next.eq('assignee_id', assigneeId);
  if (mine === 'true') next = next.eq('requester_id', actorId);
  return next as unknown as T;
}

ticketsRoute.get('/', zValidator('query', listTicketsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { page, pageSize, sort, order, status, categoryId, priority, search, assigneeId, mine } = c.req.valid('query');

  // RLS (tickets_select_participant_or_staff) เป็นตัวกรองสิทธิ์การมองเห็นจริง — filter ที่นี่เป็นแค่ UX
  let query = supabase
    .from('tickets')
    .select(
      'id, ticket_no, title, requester_id, requester_name_snapshot, department_name_snapshot, guest_name, guest_department, source_channel, category_id, priority, status, assignee_id, assignee_name_snapshot, is_security, incident_id, due_at, created_at, outsource_name, ticket_categories(name), requester:profiles!tickets_requester_id_fkey(full_name,email), assignee:profiles!tickets_assignee_id_fkey(full_name,email)',
      { count: 'exact' },
    )
    .range(...paginationRange(page, pageSize));
  query = applySort(query, { sort, order }, TICKET_SORT_COLUMNS, { column: 'created_at', ascending: false });

  query = applyTicketListFilters(query, { status, categoryId, priority, search, assigneeId, mine }, actorId);

  const { data, count, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'TICKETS_LIST_FAILED', 'ดึงรายการ Ticket ไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});

/** KPI 4 ใบของหน้า Help Desk เดิม คำนวณจากข้อมูลที่ RLS อนุญาตให้ผู้ใช้คนนี้มองเห็นเท่านั้น */
ticketsRoute.get('/summary', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase
    .from('tickets')
    .select('status,due_at,is_security,rating');
  if (error) return c.json(fail(reqId, 'TICKET_SUMMARY_FAILED', 'โหลดสรุป Ticket ไม่สำเร็จ'), 400);

  const terminal = new Set<string>([
    TICKET_STATUS.RESOLVED,
    TICKET_STATUS.CLOSED,
    TICKET_STATUS.CANCELLED,
    TICKET_STATUS.ESCALATED,
  ]);
  const now = Date.now();
  const rows = data ?? [];
  const openRows = rows.filter((ticket) => !terminal.has(String(ticket.status)));
  const ratings = rows
    .map((ticket) => Number(ticket.rating))
    .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);

  return c.json(ok(reqId, {
    open: openRows.length,
    overdue: openRows.filter((ticket) => ticket.due_at && new Date(ticket.due_at).getTime() < now).length,
    security: openRows.filter((ticket) => ticket.is_security).length,
    averageRating: ratings.length ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10 : null,
    ratingCount: ratings.length,
  }));
});

/**
 * รายชื่อเจ้าหน้าที่ที่มอบหมายได้ (สำหรับ dropdown) — ต้องอยู่ก่อน '/:id' ไม่งั้น Hono จะจับคำว่า
 * "assignable-staff" เป็นค่า :id แทน ใช้ Admin client เพราะ RLS ของ profiles จำกัดให้เห็นแค่แถวตนเอง
 * (เว้นแต่มี user.manage) แต่เจ้าหน้าที่ที่มี ticket.update/ticket.assign ไม่จำเป็นต้องมี user.manage
 */
ticketsRoute.get('/assignable-staff', async (c) => {
  const reqId = c.get('requestId');
  const [canUpdate, canAssign] = await Promise.all([hasPerm(c, 'ticket.update'), hasPerm(c, 'ticket.assign')]);
  if (!canUpdate && !canAssign) {
    return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดำเนินการนี้'), 403);
  }
  const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name');
  if (error) {
    return c.json(fail(reqId, 'ASSIGNABLE_STAFF_LOAD_FAILED', 'ดึงรายชื่อเจ้าหน้าที่ไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

ticketsRoute.get('/:id', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id');

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('*, ticket_categories(name), requester:profiles!tickets_requester_id_fkey(full_name, email), assignee:profiles!tickets_assignee_id_fkey(full_name, email), cause_code:ticket_cause_codes!tickets_cause_code_id_fkey(id, code, name)')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return c.json(fail(reqId, 'TICKET_LOAD_FAILED', 'ดึงข้อมูล Ticket ไม่สำเร็จ'), 400);
  }
  if (!ticket) {
    return c.json(fail(reqId, 'TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const { data: worklogs, error: worklogError } = await supabase
    .from('ticket_worklogs')
    .select('*, actor:profiles!ticket_worklogs_actor_id_fkey(full_name, email)')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true });

  if (worklogError) {
    return c.json(fail(reqId, 'TICKET_WORKLOGS_LOAD_FAILED', 'ดึงประวัติการดำเนินงานไม่สำเร็จ'), 400);
  }

  const admin = createAdminClient(c.env);
  const { data: attachmentRows, error: attachmentError } = await admin
    .from('file_attachments')
    .select('id, storage_path, original_filename, mime_type, size_bytes, created_at, uploader_label')
    .eq('module', 'ticket')
    .eq('target_table', 'tickets')
    .eq('target_id', id)
    .order('created_at', { ascending: true });
  if (attachmentError) {
    return c.json(fail(reqId, 'TICKET_ATTACHMENTS_LOAD_FAILED', 'ดึงไฟล์แนบไม่สำเร็จ'), 400);
  }
  const attachments = await Promise.all((attachmentRows ?? []).map(async ({ storage_path, ...attachment }) => {
    const signed = await createSignedUrl(admin, storage_path, 3600);
    return { ...attachment, signed_url: 'url' in signed ? signed.url : null };
  }));

  let signaturePath = ticket.signature_storage_path ? String(ticket.signature_storage_path) : '';
  let signatureSource: 'ticket' | 'default' | null = signaturePath ? 'ticket' : null;
  let signatureUploadedAt = ticket.signature_uploaded_at ?? null;
  if (!signaturePath) {
    const { data: setting } = await admin.from('system_settings').select('value, updated_at').eq('key', TICKET_FORM_SIGNATURE_KEY).maybeSingle();
    signaturePath = String(setting?.value ?? '');
    if (signaturePath) {
      signatureSource = 'default';
      signatureUploadedAt = setting?.updated_at ?? null;
    }
  }
  let signatureUrl: string | null = null;
  if (signaturePath) {
    const { data } = await admin.storage
      .from(TICKET_SIGNATURE_BUCKET)
      .createSignedUrl(signaturePath, 3600);
    signatureUrl = data?.signedUrl ?? null;
  }

  // field_outcomes มาจาก state machine ตัวเดียวกับที่ PATCH บังคับ จอหน้างานจึงเสนอเฉพาะสิ่งที่ทำได้จริง
  return c.json(ok(reqId, { ...ticket, signature_url: signatureUrl, signature_source: signatureSource, signature_uploaded_at: signatureUploadedAt, attachments, worklogs: worklogs ?? [], field_outcomes: fieldOutcomesFor(String(ticket.status)) }));
});

ticketsRoute.post(
  '/:id/conversation',
  zValidator('json', addTicketConversationSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    // RLS on tickets establishes that the caller is the requester, assignee or ticket.view_all staff.
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('id, ticket_no, title, status, requester_id, assignee_id')
      .eq('id', id)
      .maybeSingle();
    if (ticketError || !ticket) {
      return c.json(fail(reqId, 'TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
    }

    const internal = body.visibility === 'internal';
    if (internal) {
      const [canWriteInternal, canUpdate] = await Promise.all([
        hasPerm(c, 'ticket.internal_note'),
        hasPerm(c, 'ticket.update'),
      ]);
      if (!canWriteInternal || !canUpdate) {
        return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์เพิ่มบันทึกภายใน'), 403);
      }
    } else {
      if (!await hasPerm(c, 'ticket.comment')) {
        return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์สนทนาใน Ticket นี้'), 403);
      }
      if ([TICKET_STATUS.CLOSED, TICKET_STATUS.CANCELLED].includes(ticket.status as typeof TICKET_STATUS.CLOSED)) {
        return c.json(fail(reqId, 'TICKET_CONVERSATION_LOCKED', 'Ticket ที่ปิดหรือยกเลิกแล้วไม่รับข้อความสาธารณะเพิ่มเติม'), 409);
      }
    }

    // Internal notes are service-role writes because RLS deliberately blocks all browser-direct
    // internal_note inserts. The permission and record-access checks above are both required.
    const client = internal ? createAdminClient(c.env) : supabase;
    const { data, error } = await client
      .from('ticket_worklogs')
      .insert({
        ticket_id: id,
        entry_type: internal ? 'internal_note' : 'comment',
        action: internal ? 'บันทึกภายใน' : 'ข้อความสนทนา',
        detail: body.message,
        is_public: !internal,
        actor_id: actorId,
        actor_email_snapshot: c.get('userEmail'),
      })
      .select('*, actor:profiles!ticket_worklogs_actor_id_fkey(full_name, email)')
      .single();
    if (error) return dbFailJson(c, 'TICKET_CONVERSATION_CREATE_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: internal ? 'INTERNAL_NOTE' : 'COMMENT',
      module: 'ticket',
      targetTable: 'ticket_worklogs',
      targetId: data.id,
      detail: { ticketId: id, visibility: body.visibility },
      requestId: reqId,
    });

    if (!internal) {
      const recipientId = actorId === ticket.requester_id ? ticket.assignee_id : ticket.requester_id;
      if (recipientId && recipientId !== actorId) {
        await sendNotification(c.env, {
          recipientId,
          type: 'ticket_comment',
          title: `มีข้อความใหม่ใน ${ticket.ticket_no}`,
          link: `/tickets/${id}`,
        });
      }
    }

    return c.json(ok(reqId, data), 201);
  },
);

ticketsRoute.post('/', requirePermission('ticket.create'), zValidator('json', createTicketSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  const { data: category, error: categoryError } = await supabase
    .from('ticket_categories')
    .select('*')
    .eq('id', body.categoryId)
    .eq('status', 'active')
    .maybeSingle();
  if (categoryError || !category) {
    return c.json(fail(reqId, 'TICKET_CATEGORY_INVALID', 'กรุณาเลือกหมวดหมู่ Ticket ที่ใช้งานอยู่'), 400);
  }

  const priority = body.priority ?? category.default_priority ?? 'ปานกลาง';
  const responseSlaHours = Number(category.response_sla_hours ?? 4);
  const resolutionSlaHours = Number(category.resolution_sla_hours ?? category.sla_hours ?? 24);
  const now = new Date();
  const businessCalendar = await loadTicketBusinessCalendar(c);
  const responseDueAt = addTicketBusinessHours(now, responseSlaHours, businessCalendar);
  const dueAt = addTicketBusinessHours(now, resolutionSlaHours, businessCalendar);

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      title: body.title,
      requester_id: actorId,
      requester_phone: body.requesterPhone ?? null,
      location: body.location ?? null,
      asset_id: body.assetId ?? null,
      category_id: body.categoryId,
      priority,
      response_sla_hours: responseSlaHours,
      resolution_sla_hours: resolutionSlaHours,
      response_due_at: responseDueAt.toISOString(),
      due_at: dueAt.toISOString(),
      description: body.description,
      is_security: body.isSecurity || category.is_security_default || false,
      status: TICKET_STATUS.NEW,
      created_by: actorId,
    })
    .select()
    .single();

  if (error) {
    return dbFailJson(c, 'TICKET_CREATE_FAILED', error);
  }

  // ผู้แจ้งทั่วไปมีแค่ ticket.create ไม่มี ticket.update ซึ่ง RLS insert policy ของ ticket_worklogs
  // ต้องการ (เพื่อกันไม่ให้ผู้แจ้งแต่งประวัติ worklog เองได้ตามใจ) — รายการ "เปิด Ticket" นี้เป็น
  // entry ที่ระบบสร้างอัตโนมัติหลังตรวจสอบทุกอย่างแล้ว จึงใช้ Admin client เขียนแทนในจุดนี้จุดเดียว
  const adminForWorklog = createAdminClient(c.env);
  await adminForWorklog.from('ticket_worklogs').insert({
    ticket_id: ticket.id,
    action: 'เปิด Ticket',
    status_to: TICKET_STATUS.NEW,
    detail: 'สร้างผ่านระบบ',
    is_public: true,
    actor_id: actorId,
  });

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'ticket',
    targetTable: 'tickets',
    targetId: ticket.id,
    detail: { title: body.title, categoryId: body.categoryId },
    requestId: reqId,
  });

  return c.json(ok(reqId, ticket), 201);
});

/** แถวดิบของ Ticket เท่าที่การส่งออกต้องใช้ */
interface TicketExportRow {
  ticket_no: string | null;
  title: string | null;
  requester_name_snapshot: string | null;
  department_name_snapshot: string | null;
  priority: string | null;
  status: string | null;
  assignee_name_snapshot: string | null;
  outsource_name: string | null;
  due_at: string | null;
  created_at: string | null;
  ticket_categories: { name: string | null } | null;
}

/** วันที่แบบอ่านออกใน Excel ไทย — ISO เต็มรูปแบบทำให้ช่องกว้างเกินและอ่านยาก */
function exportDateTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 16).replace('T', ' ');
}

const TICKET_EXPORT_COLUMNS: ExportColumn<TicketExportRow>[] = [
  { label: 'เลขที่', value: (row) => row.ticket_no },
  { label: 'เรื่อง', value: (row) => row.title },
  { label: 'ผู้แจ้ง', value: (row) => row.requester_name_snapshot },
  { label: 'แผนก', value: (row) => row.department_name_snapshot },
  { label: 'ประเภทปัญหา', value: (row) => row.ticket_categories?.name ?? '' },
  { label: 'ความเร่งด่วน', value: (row) => row.priority },
  { label: 'สถานะ', value: (row) => row.status },
  { label: 'ผู้รับผิดชอบ', value: (row) => row.assignee_name_snapshot },
  { label: 'Outsource', value: (row) => row.outsource_name },
  { label: 'ครบกำหนด SLA', value: (row) => exportDateTime(row.due_at) },
  { label: 'วันที่แจ้ง', value: (row) => exportDateTime(row.created_at) },
];

/**
 * ส่งออกรายการ Ticket ทั้งชุดตามตัวกรองที่ตั้งไว้ — ไม่ใช่แค่หน้าที่เปิดอยู่
 *
 * ใช้ตัวกรองตัวเดียวกับรายการบนหน้าจอ ไฟล์ที่ได้จึงตรงกับสิ่งที่ผู้ใช้เห็นเสมอ
 * และ RLS ยังกรองสิทธิ์การมองเห็นให้อีกชั้นเหมือนกับตอนแสดงรายการ
 *
 * ต้องมาก่อน route '/:id' ไม่งั้น Hono จะจับ 'export' เป็น id
 */
ticketsRoute.get('/export', zValidator('query', listTicketsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { sort, order, status, categoryId, priority, search, assigneeId, mine } = c.req.valid('query');
  const filters = { status, categoryId, priority, search, assigneeId, mine };

  // นับก่อน เพื่อไม่ต้องดึงของที่รู้อยู่แล้วว่าส่งออกไม่ได้
  const countQuery = applyTicketListFilters(
    supabase.from('tickets').select('id', { count: 'exact', head: true }),
    filters,
    actorId,
  );
  const { count, error: countError } = await countQuery;
  if (countError) return c.json(fail(reqId, 'TICKETS_EXPORT_FAILED', 'นับรายการเพื่อส่งออกไม่สำเร็จ'), 400);

  const tooLarge = checkExportSize(count);
  if (tooLarge) return c.json(fail(reqId, 'EXPORT_TOO_LARGE', tooLarge.message), 400);

  let query = supabase
    .from('tickets')
    .select(
      'ticket_no, title, requester_name_snapshot, department_name_snapshot, priority, status, assignee_name_snapshot, outsource_name, due_at, created_at, ticket_categories(name)',
    )
    .range(0, LIST_EXPORT_MAX_ROWS - 1);
  query = applySort(query, { sort, order }, TICKET_SORT_COLUMNS, { column: 'created_at', ascending: false });
  query = applyTicketListFilters(query, filters, actorId);

  const { data, error } = await query;
  if (error) return c.json(fail(reqId, 'TICKETS_EXPORT_FAILED', 'ดึงข้อมูลเพื่อส่งออกไม่สำเร็จ'), 400);

  const rows = (data ?? []) as unknown as TicketExportRow[];
  // การดึงข้อมูลทั้งชุดออกจากระบบเป็นเหตุการณ์ที่งาน ISMS ต้องตรวจย้อนได้ ไม่ใช่แค่การอ่านหน้าจอ
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'EXPORT',
    module: 'ticket',
    targetTable: 'tickets',
    detail: { filters, rowCount: rows.length },
    requestId: reqId,
  });

  return c.json(ok(reqId, {
    filename: exportFileName('tickets'),
    csv: listCsv(TICKET_EXPORT_COLUMNS, rows),
    rowCount: rows.length,
  }));
});

/**
 * แก้ไข Ticket หลายใบพร้อมกัน — มอบหมายผู้รับผิดชอบ หรือเปลี่ยนสถานะระหว่างการทำงาน
 *
 * ตรวจสิทธิ์และ state machine "รายใบ" ไม่ใช่รายชุด แล้วคืนผลแยกต่อ id เพราะการเลือก
 * 20 ใบแล้วล้มทั้งชุดเพราะใบเดียวปิดไปแล้ว บังคับให้ผู้ใช้มานั่งไล่หาเองว่าใบไหนพัง
 * ใบที่ผ่านจะถูกบันทึกจริง ใบที่ไม่ผ่านจะบอกเหตุผลกลับไปเป็นรายใบ
 *
 * การวนทีละใบกับรูปแบบผลลัพธ์อยู่ที่ runBulk (utils/bulk.ts) — ดูเหตุผลของการทำตามลำดับได้ที่นั่น
 *
 * ต้องมาก่อน route '/:id' ไม่งั้น Hono จะจับ 'bulk' เป็น id
 */
ticketsRoute.patch('/bulk', zValidator('json', bulkUpdateTicketsSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { ids, status, assigneeId, note } = c.req.valid('json');

  const [canUpdate, canAssign, canTriage] = await Promise.all([
    hasPerm(c, 'ticket.update'),
    hasPerm(c, 'ticket.assign'),
    hasPerm(c, 'ticket.triage'),
  ]);
  if (!canUpdate && !canAssign && !canTriage) {
    return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดำเนินการนี้'), 403);
  }
  if (assigneeId !== undefined && !canAssign && !canUpdate) {
    return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์มอบหมายผู้รับผิดชอบ'), 403);
  }

  // RLS กรองใบที่ผู้ใช้ไม่มีสิทธิ์เห็นออกไปเอง ใบที่หายไปจะถูกรายงานว่าไม่พบ
  const { data: currentRows, error: loadError } = await supabase.from('tickets').select('*').in('id', ids);
  if (loadError) return dbFailJson(c, 'TICKETS_BULK_LOAD_FAILED', loadError);
  const byId = new Map((currentRows ?? []).map((row) => [String(row.id), row]));

  const needsCalendar = status !== undefined
    && (currentRows ?? []).some((row) => changesSlaPause(row as never, status));
  const businessCalendar = needsCalendar ? await loadTicketBusinessCalendar(c) : null;

  const result = await runBulk(ids, async (id) => {
    const current = byId.get(id);
    if (!current) throw new BulkItemError('TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง');

    const fromStatus = String(current.status);
    const toStatus = status ?? fromStatus;

    if (toStatus !== fromStatus) {
      const isLegacyTriage = fromStatus === TICKET_STATUS.NEW && toStatus === TICKET_STATUS.ACK && canTriage;
      if (!canUpdate && !isLegacyTriage) {
        throw new BulkItemError('PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์เปลี่ยนสถานะใบนี้');
      }
      try {
        assertTransition(fromStatus, toStatus);
      } catch (error) {
        throw new BulkItemError('TICKET_TRANSITION_INVALID', (error as Error).message);
      }
    }

    const now = new Date();
    const patch: Record<string, unknown> = { updated_by: actorId };
    if (assigneeId !== undefined) patch.assignee_id = assigneeId;
    if (toStatus !== fromStatus) applyStatusChange(patch, current as never, toStatus, now, businessCalendar!);

    const auditBefore = await loadAuditSnapshot(supabase, 'tickets', id);
    const { data: updated, error } = await supabase.from('tickets').update(patch).eq('id', id).select().single();
    if (error || !updated) throw new BulkItemError('TICKET_UPDATE_FAILED', 'บันทึกไม่สำเร็จ');

    await supabase.from('ticket_worklogs').insert({
      ticket_id: id,
      action: assigneeId !== undefined && toStatus === fromStatus ? 'คัดแยก/มอบหมาย' : 'บันทึกการดำเนินงาน',
      detail: note ?? null,
      status_from: fromStatus,
      status_to: (patch.status as string) ?? fromStatus,
      is_public: true,
      actor_id: actorId,
    });

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'ticket',
      targetTable: 'tickets',
      targetId: id,
      detail: { status, assigneeId, note, bulk: true },
      requestId: reqId,
      before: auditBefore,
      after: updated,
    });

    if (assigneeId && assigneeId !== current.assignee_id) {
      await sendNotification(c.env, {
        recipientId: assigneeId,
        type: 'ticket_assigned',
        title: `ท่านได้รับมอบหมาย Ticket: ${updated.title}`,
        link: `/tickets/${id}`,
      });
    }
    if (patch.status && patch.status !== fromStatus && current.requester_id !== actorId) {
      await sendNotification(c.env, {
        recipientId: current.requester_id,
        type: 'ticket_status_changed',
        title: `Ticket "${updated.title}" เปลี่ยนสถานะเป็น ${patch.status}`,
        link: `/tickets/${id}`,
      });
    }

    return { id, ticketNo: String(updated.ticket_no), status: String(updated.status) };
  });

  return c.json(ok(reqId, result));
});

ticketsRoute.patch('/:id', zValidator('json', updateTicketSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const { data: current, error: currentError } = await supabase.from('tickets').select('*').eq('id', id).maybeSingle();
  if (currentError || !current) {
    return c.json(fail(reqId, 'TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const [canUpdate, canClose, canAssign, canTriage] = await Promise.all([
    hasPerm(c, 'ticket.update'),
    hasPerm(c, 'ticket.close'),
    hasPerm(c, 'ticket.assign'),
    hasPerm(c, 'ticket.triage'),
  ]);
  if (!canUpdate && !canClose && !canAssign && !canTriage) {
    return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดำเนินการนี้'), 403);
  }
  if (body.assigneeId !== undefined && !canAssign && !canUpdate) {
    return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์มอบหมายผู้รับผิดชอบ'), 403);
  }

  const fromStatus = String(current.status);
  const toStatus = body.status ?? fromStatus;
  // การยกระดับต้องสร้าง Incident + ความสัมพันธ์ 1:1 + worklog พร้อมกันผ่าน endpoint
  // /incidents/from-ticket/:ticketId เท่านั้น ห้ามเปลี่ยนสถานะเปล่า ๆ จน provenance ขาด
  if (toStatus === TICKET_STATUS.ESCALATED && toStatus !== fromStatus) {
    return c.json(
      fail(reqId, 'TICKET_ESCALATION_ENDPOINT_REQUIRED', 'กรุณาใช้คำสั่งยกระดับเป็น Incident เพื่อสร้างเคสและความสัมพันธ์ให้ครบถ้วน'),
      400,
    );
  }
  const isReopen = (fromStatus === TICKET_STATUS.RESOLVED || fromStatus === TICKET_STATUS.CLOSED) && toStatus === TICKET_STATUS.IN_PROGRESS;
  const closingStatuses: string[] = [TICKET_STATUS.CLOSED, TICKET_STATUS.CANCELLED];

  if (isReopen) {
    if (!canClose) return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์เปิดงานซ้ำ'), 403);
    if (!body.note) {
      return c.json(fail(reqId, 'VALIDATION_ERROR', 'กรุณาระบุเหตุผลการเปิดงานซ้ำ', [{ field: 'note', message: 'จำเป็น' }]), 400);
    }
  } else if (closingStatuses.includes(toStatus) && toStatus !== fromStatus) {
    if (!canClose) return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ปิด/ยกเลิก Ticket'), 403);
    try {
      assertTransition(fromStatus, toStatus);
    } catch (e) {
      return c.json(fail(reqId, 'TICKET_TRANSITION_INVALID', (e as Error).message), 400);
    }
    if (toStatus === TICKET_STATUS.CLOSED && !body.resolution && !current.resolution) {
      return c.json(
        fail(reqId, 'VALIDATION_ERROR', 'กรุณาระบุผลการแก้ไขก่อนปิดงาน', [{ field: 'resolution', message: 'จำเป็น' }]),
        400,
      );
    }
    if (toStatus === TICKET_STATUS.CANCELLED && !body.note) {
      return c.json(
        fail(reqId, 'VALIDATION_ERROR', 'กรุณาระบุเหตุผลการยกเลิก', [{ field: 'note', message: 'จำเป็น' }]),
        400,
      );
    }
  } else if (toStatus !== fromStatus) {
    const isLegacyTriage = fromStatus === TICKET_STATUS.NEW && toStatus === TICKET_STATUS.ACK && canTriage;
    if (!canUpdate && !isLegacyTriage) return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดำเนินการนี้'), 403);
    try {
      assertTransition(fromStatus, toStatus);
    } catch (e) {
      return c.json(fail(reqId, 'TICKET_TRANSITION_INVALID', (e as Error).message), 400);
    }
    if (toStatus === TICKET_STATUS.OUTSOURCE && !body.outsourceVendorId && !body.outsourceName && !current.outsource_name) {
      return c.json(
        fail(reqId, 'VALIDATION_ERROR', 'กรุณาระบุชื่อผู้ให้บริการภายนอก', [{ field: 'outsourceName', message: 'จำเป็น' }]),
        400,
      );
    }
  } else if (!canUpdate) {
    // ไม่ได้เปลี่ยนสถานะ แค่แก้ field อื่น (assignee/priority/category/...) — ต้องมี ticket.update
    // เว้นแต่เป็นการมอบหมาย assignee อย่างเดียวซึ่งอนุญาตด้วย ticket.assign ไปแล้วข้างบน
    const onlyAssigneeChange = Object.keys(body).every((k) => k === 'assigneeId' || k === 'note');
    const onlyTriageFields = canTriage && Object.keys(body).every((k) =>
      ['categoryId', 'priority', 'assigneeId', 'isSecurity', 'note'].includes(k),
    );
    if (!onlyAssigneeChange && !onlyTriageFields) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดำเนินการนี้'), 403);
    }
  }

  const patch: Record<string, unknown> = { updated_by: actorId };
  const now = new Date();
  const businessCalendar = body.categoryId !== undefined || isReopen || changesSlaPause(current, toStatus)
    ? await loadTicketBusinessCalendar(c)
    : null;

  if (body.categoryId !== undefined && body.categoryId !== current.category_id) {
    const { data: category } = await supabase.from('ticket_categories').select('*').eq('id', body.categoryId).eq('status', 'active').maybeSingle();
    if (!category) {
      return c.json(fail(reqId, 'TICKET_CATEGORY_INVALID', 'หมวดหมู่ Ticket ไม่ถูกต้อง'), 400);
    }
    patch.category_id = body.categoryId;
    if (!body.priority) patch.priority = category.default_priority;
    const responseSlaHours = Number(category.response_sla_hours ?? current.response_sla_hours ?? 4);
    const resolutionSlaHours = Number(category.resolution_sla_hours ?? category.sla_hours ?? current.resolution_sla_hours ?? 24);
    patch.response_sla_hours = responseSlaHours;
    patch.resolution_sla_hours = resolutionSlaHours;
    const legacySlaBase = new Date(current.created_at);
    patch.response_due_at = addTicketBusinessHours(legacySlaBase, responseSlaHours, businessCalendar!).toISOString();
    patch.due_at = addTicketBusinessHours(legacySlaBase, resolutionSlaHours, businessCalendar!).toISOString();
  }
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.location !== undefined) patch.location = body.location;
  if (body.isSecurity !== undefined) patch.is_security = body.isSecurity;
  if (body.assigneeId !== undefined) patch.assignee_id = body.assigneeId;
  if (body.outsourceName !== undefined) patch.outsource_name = body.outsourceName;
  if (body.outsourceVendorId !== undefined) {
    patch.outsource_vendor_id = body.outsourceVendorId || null;
    if (body.outsourceVendorId) {
      const { data: vendor } = await supabase.from('vendors').select('name, status').eq('id', body.outsourceVendorId).maybeSingle();
      if (!vendor) return c.json(fail(reqId, 'VENDOR_NOT_FOUND', 'ไม่พบผู้ให้บริการภายนอกที่เลือก'), 400);
      if (vendor.status !== 'Active') return c.json(fail(reqId, 'VENDOR_INACTIVE', 'ผู้ให้บริการภายนอกที่เลือกถูกปิดใช้งาน'), 400);
      patch.outsource_name = vendor.name;
    }
  }
  if (body.outsourceIssueNo !== undefined) patch.outsource_issue_no = body.outsourceIssueNo;

  if (isReopen) {
    patch.status = TICKET_STATUS.IN_PROGRESS;
    patch.resolved_at = null;
    patch.closed_at = null;
    patch.sla_paused_at = null;
    patch.sla_paused_minutes = 0;
    const responseSlaHours = Number(patch.response_sla_hours ?? current.response_sla_hours ?? 4);
    const resolutionSlaHours = Number(patch.resolution_sla_hours ?? current.resolution_sla_hours ?? 24);
    patch.response_due_at = addTicketBusinessHours(now, responseSlaHours, businessCalendar!).toISOString();
    patch.due_at = addTicketBusinessHours(now, resolutionSlaHours, businessCalendar!).toISOString();
    patch.reopen_count = (current.reopen_count ?? 0) + 1;
  } else if (toStatus !== fromStatus) {
    applyStatusChange(patch, current, toStatus, now, businessCalendar!);
  }
  if (body.resolution !== undefined) patch.resolution = body.resolution;
  if (body.rootCause !== undefined) patch.root_cause = body.rootCause || null;
  if (body.causeCodeId !== undefined) patch.cause_code_id = body.causeCodeId || null;

  const auditBefore = await loadAuditSnapshot(supabase, 'tickets', id);
  const { data: updated, error } = await supabase.from('tickets').update(patch).eq('id', id).select().single();
  if (error) {
    return dbFailJson(c, 'TICKET_UPDATE_FAILED', error);
  }

  const worklogAction = isReopen
    ? 'เปิดงานซ้ำ'
    : toStatus === TICKET_STATUS.ACK && fromStatus === TICKET_STATUS.NEW
      ? 'รับเรื่อง'
      : toStatus === TICKET_STATUS.OUTSOURCE
        ? 'ส่งต่อ Outsource'
        : toStatus === TICKET_STATUS.CLOSED
          ? 'ปิดงาน'
          : toStatus === TICKET_STATUS.CANCELLED
            ? 'ยกเลิกงาน'
            : body.assigneeId !== undefined || body.categoryId !== undefined
              ? 'คัดแยก/มอบหมาย'
              : 'บันทึกการดำเนินงาน';

  await supabase.from('ticket_worklogs').insert({
    ticket_id: id,
    action: worklogAction,
    detail: body.note ?? null,
    status_from: fromStatus,
    status_to: (patch.status as string) ?? fromStatus,
    minutes_spent: body.minutesSpent ?? null,
    is_public: true,
    actor_id: actorId,
  });

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'ticket',
    targetTable: 'tickets',
    targetId: id,
    detail: body,
    requestId: reqId,
    before: auditBefore,
    after: updated,
  });

  if (body.assigneeId && body.assigneeId !== current.assignee_id) {
    await sendNotification(c.env, {
      recipientId: body.assigneeId,
      type: 'ticket_assigned',
      title: `ท่านได้รับมอบหมาย Ticket: ${updated.title}`,
      link: `/tickets/${id}`,
    });
  }
  if (patch.status && patch.status !== fromStatus && current.requester_id !== actorId) {
    await sendNotification(c.env, {
      recipientId: current.requester_id,
      type: 'ticket_status_changed',
      title: `Ticket "${updated.title}" เปลี่ยนสถานะเป็น ${patch.status}`,
      link: `/tickets/${id}`,
    });
    const lineTarget = await resolveTicketRequesterLineTarget(c.env, current.requester_line_user_id);
    if (lineTarget) {
      await sendLinePush(c.env, lineTarget.target, `Ticket "${updated.title}" เปลี่ยนสถานะเป็น ${patch.status}`, lineTarget.lineUserId);
    }
  }

  return c.json(ok(reqId, updated));
});

ticketsRoute.post(
  '/:id/signature',
  requirePermission('setting.manage'),
  async (c) => {
    const requestId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json(fail(requestId, 'TICKET_SIGNATURE_REQUIRED', 'กรุณาเลือกไฟล์ลายเซ็น PNG'), 400);
    }
    if (file.type !== 'image/png') {
      return c.json(fail(requestId, 'TICKET_SIGNATURE_TYPE_NOT_ALLOWED', 'ลายเซ็นต้องเป็นไฟล์ PNG เท่านั้น'), 400);
    }
    if (file.size > MAX_TICKET_SIGNATURE_BYTES) {
      return c.json(fail(requestId, 'TICKET_SIGNATURE_TOO_LARGE', 'ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB'), 400);
    }
    const signature = await verifyFileSignature(file, 'image/png');
    if (!signature.ok) {
      return c.json(fail(requestId, 'TICKET_SIGNATURE_CONTENT_MISMATCH', signature.reason ?? 'เนื้อหาไฟล์ไม่ใช่ PNG'), 400);
    }

    const admin = createAdminClient(c.env);
    const { data: ticket, error: ticketError } = await admin
      .from('tickets')
      .select('id, signature_storage_path')
      .eq('id', id)
      .maybeSingle();
    if (ticketError || !ticket) return c.json(fail(requestId, 'TICKET_NOT_FOUND', 'ไม่พบ Ticket ที่ระบุ'), 404);

    const path = `tickets/${id}/${crypto.randomUUID()}.png`;
    const { error: uploadError } = await admin.storage.from(TICKET_SIGNATURE_BUCKET).upload(path, file, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadError) return dbFailJson(c, 'TICKET_SIGNATURE_UPLOAD_FAILED', uploadError);

    const uploadedAt = new Date().toISOString();
    const { error: updateError } = await admin.from('tickets').update({
      signature_storage_path: path,
      signature_uploaded_by: actorId,
      signature_uploaded_at: uploadedAt,
    }).eq('id', id);
    if (updateError) {
      await admin.storage.from(TICKET_SIGNATURE_BUCKET).remove([path]);
      return dbFailJson(c, 'TICKET_SIGNATURE_SAVE_FAILED', updateError);
    }
    if (ticket.signature_storage_path && ticket.signature_storage_path !== path) {
      await admin.storage.from(TICKET_SIGNATURE_BUCKET).remove([String(ticket.signature_storage_path)]);
    }
    const { data: signed } = await admin.storage.from(TICKET_SIGNATURE_BUCKET).createSignedUrl(path, 3600);
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPLOAD_SIGNATURE',
      module: 'ticket',
      targetTable: 'tickets',
      targetId: id,
      detail: { mimeType: 'image/png', sizeBytes: file.size, replaced: Boolean(ticket.signature_storage_path) },
      requestId,
    });
    return c.json(ok(requestId, { signatureUrl: signed?.signedUrl ?? null, uploadedAt }));
  },
);

ticketsRoute.delete('/:id/signature', requirePermission('setting.manage'), async (c) => {
  const requestId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id');
  const admin = createAdminClient(c.env);
  const { data: ticket, error } = await admin.from('tickets').select('id, signature_storage_path').eq('id', id).maybeSingle();
  if (error || !ticket) return c.json(fail(requestId, 'TICKET_NOT_FOUND', 'ไม่พบ Ticket ที่ระบุ'), 404);
  if (!ticket.signature_storage_path) return c.json(ok(requestId, { deleted: false }));

  const path = String(ticket.signature_storage_path);
  const { error: updateError } = await admin.from('tickets').update({
    signature_storage_path: null,
    signature_uploaded_by: null,
    signature_uploaded_at: null,
  }).eq('id', id);
  if (updateError) return dbFailJson(c, 'TICKET_SIGNATURE_DELETE_FAILED', updateError);
  await admin.storage.from(TICKET_SIGNATURE_BUCKET).remove([path]);
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'DELETE_SIGNATURE',
    module: 'ticket',
    targetTable: 'tickets',
    targetId: id,
    requestId,
  });
  return c.json(ok(requestId, { deleted: true }));
});

ticketsRoute.post(
  '/:id/feedback',
  zValidator('json', submitTicketFeedbackSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('tickets').select('*').eq('id', id).maybeSingle();
    if (currentError || !current) {
      return c.json(fail(reqId, 'TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
    }
    if (current.requester_id !== actorId) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ให้คะแนนได้เฉพาะผู้แจ้ง Ticket นี้เท่านั้น'), 403);
    }
    const ratable = current.status === TICKET_STATUS.CLOSED && !current.rating;
    if (!ratable) {
      return c.json(fail(reqId, 'TICKET_NOT_RATABLE', 'ให้คะแนนได้เฉพาะ Ticket ที่ปิดงานแล้วและยังไม่เคยให้คะแนน'), 400);
    }

    const admin = createAdminClient(c.env);
    const { data: criteria, error: criteriaError } = await loadActiveRatingCriteria(admin);
    if (criteriaError || !criteria?.length) {
      return c.json(fail(reqId, 'TICKET_RATING_CRITERIA_UNAVAILABLE', 'ไม่พบหัวข้อประเมินที่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ'), 409);
    }
    if (!ratingsMatchCriteria(body.ratings, criteria.map((criterion) => String(criterion.key)))) {
      return c.json(fail(reqId, 'TICKET_RATING_CRITERIA_CHANGED', 'หัวข้อประเมินมีการเปลี่ยนแปลง กรุณารีเฟรชหน้าแล้วให้คะแนนใหม่'), 409);
    }
    const rating = calculateTicketOverallRating(body.ratings);
    const ratingSnapshot = criteria.map((criterion) => ({
      key: String(criterion.key),
      label: String(criterion.label),
      score: body.ratings[String(criterion.key)],
    }));
    const { data, error } = await admin
      .from('tickets')
      .update({ rating, rating_details: body.ratings, rating_criteria_snapshot: ratingSnapshot, feedback: body.feedback ?? null, feedback_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return dbFailJson(c, 'TICKET_FEEDBACK_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'FEEDBACK',
      module: 'ticket',
      targetTable: 'tickets',
      targetId: id,
      detail: { ...body, rating },
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);
