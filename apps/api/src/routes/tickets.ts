import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { resolveTicketRequesterLineTarget, sendLinePush } from '../lib/lineMessaging';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import { addTicketBusinessHours, parseTicketBusinessCalendar, ticketBusinessMinutesBetween } from '../services/ticketSlaService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import { createTicketSchema, listTicketsQuerySchema, submitTicketFeedbackSchema, updateTicketSchema } from '../validators/tickets';

/**
 * Help Desk / Ticket — สืบทอดจาก Tickets/Ticket_Worklogs เดิม (Module_Ticket.gs) เฉพาะเส้นทาง
 * ผู้ใช้ที่ login ผ่าน Supabase Auth แล้ว — เส้นทางแจ้งซ่อมสาธารณะผ่าน LINE อยู่ที่ routes/line.ts
 * แยกกันเพราะผู้ใช้ LINE ไม่มี Supabase JWT (ดู R-11, ตัดสินใจแล้ว 2026-08-10)
 * SLA due date ใช้เวลาทำการ Asia/Bangkok ตาม Settings เดียวกับ Legacy
 */
export const ticketsRoute = new Hono<AppEnv>();
ticketsRoute.use('*', requireAuth);

const TICKET_STATUS = {
  NEW: 'ใหม่',
  ACK: 'รับเรื่องแล้ว',
  IN_PROGRESS: 'กำลังดำเนินการ',
  WAITING_PARTS: 'รออะไหล่',
  WAITING_USER: 'รอผู้ใช้งาน',
  OUTSOURCE: 'ส่งต่อ Outsource',
  RESOLVED: 'เสร็จสิ้น',
  CLOSED: 'ปิดงาน',
  CANCELLED: 'ยกเลิก',
  ESCALATED: 'ยกระดับเป็น Incident',
} as const;

const ACTIVE_WORK_STATUSES: string[] = [
  TICKET_STATUS.IN_PROGRESS,
  TICKET_STATUS.WAITING_PARTS,
  TICKET_STATUS.WAITING_USER,
  TICKET_STATUS.OUTSOURCE,
  TICKET_STATUS.RESOLVED,
  TICKET_STATUS.CLOSED,
  TICKET_STATUS.CANCELLED,
  TICKET_STATUS.ESCALATED,
];

const TRANSITIONS: Record<string, string[]> = {
  [TICKET_STATUS.NEW]: [
    TICKET_STATUS.ACK,
    TICKET_STATUS.IN_PROGRESS,
    TICKET_STATUS.OUTSOURCE,
    TICKET_STATUS.CLOSED,
    TICKET_STATUS.CANCELLED,
    TICKET_STATUS.ESCALATED,
  ],
  [TICKET_STATUS.ACK]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.IN_PROGRESS]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.WAITING_PARTS]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.WAITING_USER]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.OUTSOURCE]: ACTIVE_WORK_STATUSES,
  [TICKET_STATUS.RESOLVED]: [TICKET_STATUS.CLOSED],
  [TICKET_STATUS.CLOSED]: [],
  [TICKET_STATUS.CANCELLED]: [],
  [TICKET_STATUS.ESCALATED]: [],
};

function assertTransition(from: string, to: string) {
  if (!to || from === to) return;
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`ไม่สามารถเปลี่ยนสถานะ Ticket จาก "${from}" เป็น "${to}" ได้`);
  }
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

ticketsRoute.get('/', zValidator('query', listTicketsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { page, pageSize, status, categoryId, priority, search, assigneeId, mine } = c.req.valid('query');

  // RLS (tickets_select_participant_or_staff) เป็นตัวกรองสิทธิ์การมองเห็นจริง — filter ที่นี่เป็นแค่ UX
  let query = supabase
    .from('tickets')
    .select(
      'id, ticket_no, title, requester_id, requester_name_snapshot, department_name_snapshot, guest_name, guest_department, source_channel, category_id, priority, status, assignee_id, assignee_name_snapshot, is_security, incident_id, due_at, created_at, outsource_name, ticket_categories(name), requester:profiles!tickets_requester_id_fkey(full_name,email), assignee:profiles!tickets_assignee_id_fkey(full_name,email)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(...paginationRange(page, pageSize));

  if (status) query = query.eq('status', status);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (priority) query = query.eq('priority', priority);
  if (search) {
    const safeSearch = cleanSearch(search);
    if (safeSearch) {
      query = query.or(
        `ticket_no.ilike.%${safeSearch}%,title.ilike.%${safeSearch}%,requester_name_snapshot.ilike.%${safeSearch}%,department_name_snapshot.ilike.%${safeSearch}%`,
      );
    }
  }
  if (assigneeId) query = query.eq('assignee_id', assigneeId);
  if (mine === 'true') query = query.eq('requester_id', actorId);

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
    .select('*, ticket_categories(name), requester:profiles!tickets_requester_id_fkey(full_name, email), assignee:profiles!tickets_assignee_id_fkey(full_name, email)')
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

  return c.json(ok(reqId, { ...ticket, worklogs: worklogs ?? [] }));
});

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
  const waitingStatuses = new Set<string>([TICKET_STATUS.WAITING_PARTS, TICKET_STATUS.WAITING_USER]);
  const changesSlaPause = toStatus !== fromStatus
    && (waitingStatuses.has(toStatus) || Boolean(current.sla_paused_at));
  const businessCalendar = body.categoryId !== undefined || isReopen || changesSlaPause
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
    patch.status = toStatus;
    if (toStatus === TICKET_STATUS.ACK && !current.acknowledged_at) patch.acknowledged_at = now.toISOString();
    if (toStatus === TICKET_STATUS.RESOLVED) patch.resolved_at = current.resolved_at ?? now.toISOString();
    if (toStatus === TICKET_STATUS.CLOSED) {
      patch.resolved_at = current.resolved_at ?? now.toISOString();
      patch.closed_at = now.toISOString();
    }
    if (toStatus === TICKET_STATUS.CANCELLED) patch.closed_at = now.toISOString();
    if (toStatus === TICKET_STATUS.OUTSOURCE) patch.outsource_sent_at = current.outsource_sent_at ?? now.toISOString();
  }
  if (body.resolution !== undefined) patch.resolution = body.resolution;

  if (toStatus !== fromStatus && !isReopen) {
    if (!current.sla_paused_at && waitingStatuses.has(toStatus)) {
      patch.sla_paused_at = now.toISOString();
    } else if (current.sla_paused_at && !waitingStatuses.has(toStatus)) {
      const pausedBusinessMinutes = ticketBusinessMinutesBetween(
        new Date(current.sla_paused_at),
        now,
        businessCalendar!,
      );
      patch.sla_paused_at = null;
      patch.sla_paused_minutes = Number(current.sla_paused_minutes ?? 0) + pausedBusinessMinutes;
      const effectiveDueAt = patch.due_at ?? current.due_at;
      if (effectiveDueAt && pausedBusinessMinutes > 0) {
        patch.due_at = addTicketBusinessHours(
          new Date(String(effectiveDueAt)),
          pausedBusinessMinutes / 60,
          businessCalendar!,
        ).toISOString();
      }
    }
  }

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
    const ratable = [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].includes(current.status) && !current.rating;
    if (!ratable) {
      return c.json(fail(reqId, 'TICKET_NOT_RATABLE', 'ให้คะแนนได้เฉพาะ Ticket ที่เสร็จสิ้น/ปิดงานแล้ว และยังไม่เคยให้คะแนน'), 400);
    }

    const { data, error } = await supabase
      .from('tickets')
      .update({ rating: body.rating, feedback: body.feedback ?? null, feedback_at: new Date().toISOString() })
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
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);
