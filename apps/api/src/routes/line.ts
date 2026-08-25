import { zValidator } from '@hono/zod-validator';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { calculateTicketOverallRating } from '@itlife/shared';
import {
  completeLineLoginCallback, createLineLoginUrl, getLineLoginConfigStatus, hashSessionToken, randomToken, sessionHours,
} from '../lib/lineAuth';
import { notifyTicketTeam, sendLinePush } from '../lib/lineMessaging';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { writeAuditLog } from '../services/auditService';
import { addTicketBusinessHours, parseTicketBusinessCalendar } from '../services/ticketSlaService';
import type { AppEnv, LineUserProfile } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { ratingsMatchCriteria } from './tickets';
import {
  lineAdminListQuerySchema, lineAdminUpdateStatusSchema,
  lineLoginUrlQuerySchema, lineSubmitTicketSchema, lineTicketFeedbackSchema,
} from '../validators/line';

/**
 * Public LINE ticket portal — port of legacy-gas/LineAuth.gs + the LINE-facing parts of
 * Module_Ticket.gs. Public LINE users have no Supabase JWT, so their queries run on the
 * service-role client with authorization enforced by requireLineSession/requireUsableLineSession.
 * The admin account-management routes at the bottom use normal Supabase auth and permissions.
 */
export const lineRoute = new Hono<AppEnv>();

type LineUserRecord = LineUserProfile;

interface LineSessionContext {
  token: string;
  user: LineUserRecord;
}

async function loadLineSession(c: Context<AppEnv>): Promise<LineSessionContext | null> {
  const token = c.req.header('x-line-session') ?? '';
  if (!/^[0-9a-f]{64}$/i.test(token) || !c.env.LINE_SESSION_SECRET) return null;
  const hash = await hashSessionToken(c.env.LINE_SESSION_SECRET, token);
  const admin = createAdminClient(c.env);
  const { data: session } = await admin
    .from('line_sessions')
    .select('id, expires_at, revoked_at, last_seen_at, line_user_id, line_users(*)')
    .eq('session_hash', hash)
    .maybeSingle();
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) return null;
  const user = Array.isArray(session.line_users) ? session.line_users[0] : session.line_users;
  if (!user) return null;

  const lastSeen = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
  if (Date.now() - lastSeen > 30 * 60_000) {
    await admin.from('line_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id);
  }
  return { token, user: user as LineUserRecord };
}

/** Any known LINE identity with a valid session. */
const requireLineSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await loadLineSession(c);
  if (!session) return c.json(fail(c.get('requestId'), 'LINE_SESSION_REQUIRED', 'LINE session หมดอายุ กรุณาเข้าสู่ระบบใหม่'), 401);
  c.set('lineSession', session);
  await next();
};

/** Ticket actions use the LINE identity directly. Admins may still suspend an abusive or compromised account. */
const requireUsableLineSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await loadLineSession(c);
  if (!session) return c.json(fail(c.get('requestId'), 'LINE_SESSION_REQUIRED', 'LINE session หมดอายุ กรุณาเข้าสู่ระบบใหม่'), 401);
  if (session.user.link_status === 'Suspended') {
    return c.json(fail(c.get('requestId'), 'LINE_ACCOUNT_SUSPENDED', 'บัญชี LINE นี้ถูกระงับ กรุณาติดต่อส่วนงาน IT'), 403);
  }
  c.set('lineSession', session);
  await next();
};

function clientProfile(user: LineUserRecord) {
  return {
    displayName: user.display_name ?? '',
    pictureUrl: user.picture_url ?? '',
    fullName: user.full_name ?? user.display_name ?? '',
    linkStatus: user.link_status === 'Suspended' ? 'Suspended' : 'Active',
    friendStatus: user.friend_status ?? 'Unknown',
  };
}

lineRoute.get('/bootstrap', async (c) => {
  const reqId = c.get('requestId');
  const status = getLineLoginConfigStatus(c.env);
  const session = await loadLineSession(c);
  return c.json(ok(reqId, {
    configured: status.configured,
    enabled: status.enabled,
    message: status.message,
    authenticated: Boolean(session),
    requireEmployeeLink: false,
    profile: session ? clientProfile(session.user) : null,
  }));
});

lineRoute.get('/ticket-categories', async (c) => {
  const reqId = c.get('requestId');
  const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('ticket_categories').select('id, name').eq('status', 'active').order('name');
  if (error) return dbFailJson(c, 'LINE_CATEGORIES_LOAD_FAILED', error);
  return c.json(ok(reqId, data ?? []));
});

lineRoute.get(
  '/login-url',
  edgeRateLimit({ keyFn: (c) => `line_login_url:${clientIp(c)}` }),
  rateLimit({ windowMs: 60_000, max: 20, keyFn: (c) => `line_login_url:${clientIp(c)}` }),
  zValidator('query', lineLoginUrlQuerySchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    try {
      const url = await createLineLoginUrl(c.env, c.req.valid('query').returnMode);
      return c.json(ok(reqId, { url }));
    } catch (error) {
      return dbFailJson(c, 'LINE_LOGIN_NOT_CONFIGURED', error instanceof Error ? error : { message: String(error) }, 'LINE Login ยังใช้งานไม่ได้');
    }
  },
);

/** LINE redirects the browser here directly (not an XHR) — always respond with a redirect, never JSON, so the user lands back on a normal page. */
lineRoute.get('/callback', async (c) => {
  const query = c.req.query();
  const frontendBase = c.env.PUBLIC_APP_URL || new URL(c.req.url).origin;
  try {
    const result = await completeLineLoginCallback(c.env, query);
    const admin = createAdminClient(c.env);
    const now = new Date().toISOString();

    const { data: existing } = await admin.from('line_users').select('*').eq('line_user_id', result.lineUserId).maybeSingle();
    const linkStatus = existing?.link_status === 'Suspended' ? 'Suspended' : 'Active';

    const { data: user, error } = await admin
      .from('line_users')
      .upsert(
        {
          line_user_id: result.lineUserId,
          display_name: result.displayName,
          picture_url: result.pictureUrl,
          employee_code: null,
          linked_user_id: null,
          full_name: result.displayName,
          department: null,
          link_status: linkStatus,
          friend_status: result.friendStatus,
          last_login_at: now,
        },
        { onConflict: 'line_user_id' },
      )
      .select('id')
      .single();
    if (error || !user) throw new Error(error?.message ?? 'บันทึกบัญชี LINE ไม่สำเร็จ');

    const token = randomToken();
    // completeLineLoginCallback above already validated LINE config (throws otherwise), so the secret is set here.
    const hash = await hashSessionToken(c.env.LINE_SESSION_SECRET!, token);
    await admin.from('line_sessions').insert({
      session_hash: hash,
      line_user_id: user.id,
      expires_at: new Date(Date.now() + sessionHours(c.env) * 3600_000).toISOString(),
    });

    await writeAuditLog(c.env, {
      actorEmail: `LINE:${result.lineUserId}`, action: 'LINE_LOGIN', module: 'ticket',
      targetTable: 'line_users', targetId: result.lineUserId, detail: { returnMode: result.returnMode }, requestId: c.get('requestId'),
    });

    const redirect = new URL('/line/callback', frontendBase);
    redirect.hash = new URLSearchParams({ token, mode: result.returnMode }).toString();
    return c.redirect(redirect.toString(), 302);
  } catch (error) {
    const redirect = new URL('/line/callback', frontendBase);
    redirect.hash = new URLSearchParams({
      error: error instanceof Error ? error.message : 'เข้าสู่ระบบ LINE ไม่สำเร็จ',
    }).toString();
    return c.redirect(redirect.toString(), 302);
  }
});

lineRoute.post('/logout', requireLineSession, async (c) => {
  const reqId = c.get('requestId');
  const { token } = c.get('lineSession')!;
  const admin = createAdminClient(c.env);
  // requireLineSession above already proved LINE_SESSION_SECRET is set (loadLineSession returns null otherwise).
  const hash = await hashSessionToken(c.env.LINE_SESSION_SECRET!, token);
  await admin.from('line_sessions').update({ revoked_at: new Date().toISOString() }).eq('session_hash', hash);
  return c.json(ok(reqId, { loggedOut: true }));
});

lineRoute.post(
  '/tickets',
  requireUsableLineSession,
  rateLimit({ windowMs: 3600_000, max: 20, keyFn: (c) => `line_ticket_create:${c.get('lineSession')!.user.id}` }),
  zValidator('json', lineSubmitTicketSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { user } = c.get('lineSession')!;
    const body = c.req.valid('json');
    const admin = createAdminClient(c.env);

    const { data: category } = await admin.from('ticket_categories').select('*').eq('id', body.categoryId).eq('status', 'active').maybeSingle();
    if (!category) return c.json(fail(reqId, 'TICKET_CATEGORY_INVALID', 'กรุณาเลือกหมวดหมู่ Ticket ที่ใช้งานอยู่'), 400);

    const priority = body.priority ?? category.default_priority ?? 'ปานกลาง';
    const responseSlaHours = Number(category.response_sla_hours ?? 4);
    const resolutionSlaHours = Number(category.resolution_sla_hours ?? category.sla_hours ?? 24);
    const now = new Date();
    const { data: slaSettingRows } = await admin
      .from('system_settings')
      .select('key, value')
      .in('key', ['SLA_BUSINESS_START', 'SLA_BUSINESS_END', 'SLA_BUSINESS_DAYS', 'SLA_HOLIDAYS']);
    const businessCalendar = parseTicketBusinessCalendar(
      Object.fromEntries((slaSettingRows ?? []).map((row) => [row.key, row.value])),
    );

    const { data: ticket, error } = await admin
      .from('tickets')
      .insert({
        title: body.title,
        requester_id: null,
        requester_name_snapshot: user.display_name ?? user.full_name ?? 'ผู้ใช้งาน LINE',
        requester_identity_type: 'LINE',
        category_id: body.categoryId,
        priority,
        response_sla_hours: responseSlaHours,
        resolution_sla_hours: resolutionSlaHours,
        response_due_at: addTicketBusinessHours(now, responseSlaHours, businessCalendar).toISOString(),
        due_at: addTicketBusinessHours(now, resolutionSlaHours, businessCalendar).toISOString(),
        description: body.description,
        is_security: body.isSecurity ?? category.is_security_default ?? false,
        status: 'ใหม่',
        source_channel: 'line',
        requester_line_user_id: user.id,
        created_by: null,
      })
      .select()
      .single();
    if (error || !ticket) return dbFailJson(c, 'TICKET_CREATE_FAILED', error, 'สร้าง Ticket ไม่สำเร็จ');

    await admin.from('ticket_worklogs').insert({
      ticket_id: ticket.id, action: 'เปิด Ticket', status_to: 'ใหม่', detail: 'สร้างผ่าน LINE',
      is_public: true, actor_id: null, actor_line_user_id: user.id,
    });
    await writeAuditLog(c.env, {
      actorEmail: `LINE:${user.line_user_id}`, action: 'CREATE', module: 'ticket', targetTable: 'tickets',
      targetId: ticket.id, detail: { title: body.title, categoryId: body.categoryId, channel: 'line' }, requestId: reqId,
    });
    await notifyTicketTeam(c.env, `Ticket ใหม่จาก LINE: ${ticket.title} (${ticket.ticket_no})`);

    return c.json(ok(reqId, ticket), 201);
  },
);

lineRoute.get('/tickets', requireUsableLineSession, async (c) => {
  const reqId = c.get('requestId');
  const { user } = c.get('lineSession')!;
  const admin = createAdminClient(c.env);
  let ticketQuery = admin
    .from('tickets')
    .select('id, ticket_no, title, priority, status, created_at, category:ticket_categories(name)')
    .order('created_at', { ascending: false })
    .limit(50);
  ticketQuery = user.linked_user_id
    ? ticketQuery.or(`requester_line_user_id.eq.${user.id},requester_id.eq.${user.linked_user_id}`)
    : ticketQuery.eq('requester_line_user_id', user.id);
  const { data, error } = await ticketQuery;
  if (error) return dbFailJson(c, 'LINE_TICKET_LIST_FAILED', error);
  return c.json(ok(reqId, data ?? []));
});

lineRoute.get(
  '/tickets/:id',
  requireUsableLineSession,
  rateLimit({ windowMs: 3600_000, max: 60, keyFn: (c) => `line_ticket_track:${c.get('lineSession')!.user.id}` }),
  async (c) => {
    const reqId = c.get('requestId');
    const { user } = c.get('lineSession')!;
    const admin = createAdminClient(c.env);
    const { data: ticket } = await admin.from('tickets').select('*, category:ticket_categories(name)').eq('id', c.req.param('id')).maybeSingle();
    const belongsToLineUser = ticket?.requester_line_user_id === user.id
      || (Boolean(user.linked_user_id) && ticket?.requester_id === user.linked_user_id);
    if (!ticket || !belongsToLineUser) {
      return c.json(fail(reqId, 'LINE_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ในบัญชี LINE ของท่าน'), 404);
    }
    const [{ data: worklogs }, { data: ratingCriteria }] = await Promise.all([
      admin
      .from('ticket_worklogs').select('action, detail, status_from, status_to, created_at')
      .eq('ticket_id', ticket.id).eq('is_public', true).order('created_at', { ascending: true }),
      admin.from('ticket_rating_criteria').select('id, key, label, description, sort_order, status').eq('status', 'active').order('sort_order').order('created_at'),
    ]);
    // ไม่มีลายเซ็นกลางให้ตกทอดแล้ว — ผู้ร้องเห็นลายเซ็นเฉพาะที่มีคนเซ็นให้ใบนี้จริง
    const signaturePath = ticket.signature_storage_path ? String(ticket.signature_storage_path) : '';
    let signatureUrl: string | null = null;
    if (signaturePath) {
      const { data } = await admin.storage.from('ticket-signatures').createSignedUrl(signaturePath, 3600);
      signatureUrl = data?.signedUrl ?? null;
    }
    return c.json(ok(reqId, { ticket: { ...ticket, signature_url: signatureUrl }, ratingCriteria: ratingCriteria ?? [], worklogs: worklogs ?? [] }));
  },
);

lineRoute.post(
  '/tickets/:id/feedback',
  requireUsableLineSession,
  zValidator('json', lineTicketFeedbackSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { user } = c.get('lineSession')!;
    const admin = createAdminClient(c.env);
    const { data: ticket } = await admin.from('tickets').select('id, status, rating, requester_id, requester_line_user_id').eq('id', c.req.param('id')).maybeSingle();
    const belongsToLineUser = ticket?.requester_line_user_id === user.id
      || (Boolean(user.linked_user_id) && ticket?.requester_id === user.linked_user_id);
    if (!ticket || !belongsToLineUser) {
      return c.json(fail(reqId, 'LINE_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ในบัญชี LINE ของท่าน'), 404);
    }
    if (ticket.status !== 'ปิดงาน' || ticket.rating != null) {
      return c.json(fail(reqId, 'LINE_TICKET_FEEDBACK_NOT_ALLOWED', 'ให้คะแนนได้เฉพาะ Ticket ที่ปิดงานแล้วและยังไม่เคยประเมิน'), 400);
    }
    const { ratings, comment } = c.req.valid('json');
    const { data: criteria, error: criteriaError } = await admin
      .from('ticket_rating_criteria')
      .select('key, label')
      .eq('status', 'active')
      .order('sort_order')
      .order('created_at');
    if (criteriaError || !criteria?.length) {
      return c.json(fail(reqId, 'LINE_TICKET_RATING_CRITERIA_UNAVAILABLE', 'ไม่พบหัวข้อประเมินที่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ'), 409);
    }
    if (!ratingsMatchCriteria(ratings, criteria.map((criterion) => String(criterion.key)))) {
      return c.json(fail(reqId, 'LINE_TICKET_RATING_CRITERIA_CHANGED', 'หัวข้อประเมินมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่'), 409);
    }
    const rating = calculateTicketOverallRating(ratings);
    const ratingSnapshot = criteria.map((criterion) => ({ key: String(criterion.key), label: String(criterion.label), score: ratings[String(criterion.key)] }));
    const { error } = await admin.from('tickets').update({ rating, rating_details: ratings, rating_criteria_snapshot: ratingSnapshot, feedback: comment ?? null, feedback_at: new Date().toISOString() }).eq('id', ticket.id);
    if (error) return dbFailJson(c, 'LINE_TICKET_FEEDBACK_FAILED', error);
    return c.json(ok(reqId, { submitted: true }));
  },
);

/**
 * Admin review of pending LINE-employee links ("IT Admin ตรวจและอนุมัติจากหลังบ้าน" in legacy).
 * Staff-facing, so these two routes use requireAuth (Supabase JWT), unlike everything above.
 */
lineRoute.get(
  '/admin/links', requireAuth, requirePermission('line.manage'),
  zValidator('query', lineAdminListQuerySchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { status } = c.req.valid('query');
    let query = createAdminClient(c.env).from('line_users').select('*').order('last_login_at', { ascending: false }).limit(200);
    if (status) query = query.eq('link_status', status);
    const { data, error } = await query;
    if (error) return dbFailJson(c, 'LINE_ADMIN_LIST_FAILED', error);
    return c.json(ok(reqId, data ?? []));
  },
);

lineRoute.post(
  '/admin/links/:id/status', requireAuth, requirePermission('line.manage'),
  zValidator('json', lineAdminUpdateStatusSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { status } = c.req.valid('json');
    const admin = createAdminClient(c.env);
    const { data: current, error: currentError } = await admin
      .from('line_users')
      .select('*')
      .eq('id', c.req.param('id'))
      .maybeSingle();
    if (currentError) return dbFailJson(c, 'LINE_ADMIN_LOAD_FAILED', currentError);
    if (!current) return c.json(fail(reqId, 'LINE_USER_NOT_FOUND', 'ไม่พบบัญชี LINE นี้'), 404);
    const { data: updated, error } = await admin.from('line_users').update({ link_status: status }).eq('id', c.req.param('id')).select('*').maybeSingle();
    if (error) return dbFailJson(c, 'LINE_ADMIN_UPDATE_FAILED', error);
    if (!updated) return c.json(fail(reqId, 'LINE_USER_NOT_FOUND', 'ไม่พบบัญชี LINE นี้'), 404);
    await writeAuditLog(c.env, {
      actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'LINE_ADMIN_UPDATE_ACCOUNT_STATUS',
      module: 'line', targetTable: 'line_users', targetId: updated.id, detail: { status }, requestId: reqId,
    });
    if (current.link_status !== status && (status === 'Active' || status === 'Suspended')) {
      const message = status === 'Active'
        ? 'บัญชี LINE ของท่านกลับมาใช้งาน LINE Service Portal ได้แล้ว'
        : 'บัญชี LINE ของท่านถูกระงับการใช้งาน กรุณาติดต่อส่วนงาน IT';
      await sendLinePush(c.env, updated.line_user_id, message, updated.id);
    }
    return c.json(ok(reqId, updated));
  },
);
