import { zValidator } from '@hono/zod-validator';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { calculateTicketOverallRating } from '@itlife/shared';
import {
  completeLineLoginCallback, createLineLoginUrl, getLineLoginConfigStatus, hashSessionToken, randomToken, sessionHours,
} from '../lib/lineAuth';
import { buildTicketFlexMessage, notifyTicketTeam, sendLinePush } from '../lib/lineMessaging';
import { ticketConsentEvidence } from '../lib/privacyNotice';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { writeAuditLog } from '../services/auditService';
import { createSignedUrl, deleteFile, uploadPublicTicketFile } from '../services/storageService';
import { addTicketBusinessHours, parseTicketBusinessCalendar } from '../services/ticketSlaService';
import { saveRequesterSignature } from '../services/ticketSignatureService';
import type { AppEnv, LineUserProfile } from '../types';
import { dbFailJson } from '../utils/dbError';
import { verifyFileSignature } from '../utils/fileSignature';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { MAX_FILE_SIZE_BYTES } from '../validators/files';
import { ratingsMatchCriteria } from './tickets';
import {
  lineAdminListQuerySchema, lineAdminUpdateLinkSchema, lineAdminUpdateStatusSchema,
  lineLoginUrlQuerySchema, lineProfileSchema, lineSubmitTicketSchema, lineTicketFeedbackSchema,
  lineTicketMessageSchema,
} from '../validators/line';

/**
 * Public LINE ticket portal — port of legacy-gas/LineAuth.gs + the LINE-facing parts of
 * Module_Ticket.gs. Public LINE users have no Supabase JWT, so their queries run on the
 * service-role client with authorization enforced by requireLineSession/requireUsableLineSession.
 * The admin account-management routes at the bottom use normal Supabase auth and permissions.
 */
export const lineRoute = new Hono<AppEnv>();

const MAX_LINE_TICKET_ATTACHMENTS = 5;
/** ใบที่เดินจบแล้วไม่รับข้อความเพิ่ม — ผู้แจ้งต้องเปิดใบใหม่แทนการต่อท้ายใบเดิม */
const LINE_TICKET_MESSAGE_CLOSED_STATUSES = ['ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'];
const LINE_TICKET_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'] as const;

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
    fullName: user.full_name ?? '',
    department: user.department ?? '',
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
  // ส่ง SLA มาด้วยเพื่อให้หน้าแจ้งซ่อมบอกผู้แจ้งได้ว่าจะได้รับการตอบรับภายในกี่ชั่วโมง
  const { data, error } = await admin
    .from('ticket_categories')
    .select('id, name, default_priority, response_sla_hours, resolution_sla_hours, sla_hours')
    .eq('status', 'active')
    .order('name');
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
          // Provider login refreshes LINE-owned metadata only. Keep the administrator's
          // profile connection intact so a later login cannot silently change recipients.
          employee_code: existing?.employee_code ?? null,
          linked_user_id: existing?.linked_user_id ?? null,
          // Keep the LINE display name only as provider metadata. The requester supplies
          // their real name in the profile-completion step after login.
          full_name: existing?.full_name ?? null,
          department: existing?.department ?? null,
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

lineRoute.patch(
  '/profile',
  requireUsableLineSession,
  zValidator('json', lineProfileSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { user } = c.get('lineSession')!;
    const { fullName } = c.req.valid('json');
    const admin = createAdminClient(c.env);
    const { data, error } = await admin
      .from('line_users')
      .update({ full_name: fullName })
      .eq('id', user.id)
      .select('*')
      .single();
    if (error || !data) return dbFailJson(c, 'LINE_PROFILE_UPDATE_FAILED', error, 'บันทึกชื่อ–นามสกุลไม่สำเร็จ');

    // Correct the requester snapshot on tickets that are still in progress. This also repairs
    // tickets created before LINE display names were separated from real requester names.
    const { error: ticketNameError } = await admin
      .from('tickets')
      .update({ requester_name_snapshot: fullName })
      .eq('requester_line_user_id', user.id)
      .in('status', ['ใหม่', 'รับเรื่องแล้ว', 'กำลังดำเนินการ', 'รออะไหล่', 'รอผู้ใช้งาน', 'ส่งต่อ Outsource', 'เสร็จสิ้น']);
    if (ticketNameError) return dbFailJson(c, 'LINE_TICKET_REQUESTER_NAME_UPDATE_FAILED', ticketNameError, 'อัปเดตชื่อผู้แจ้งใน Ticket ไม่สำเร็จ');

    await writeAuditLog(c.env, {
      actorEmail: `LINE:${user.line_user_id}`, action: 'UPDATE', module: 'ticket',
      targetTable: 'line_users', targetId: user.id, detail: { fields: ['full_name'] }, requestId: reqId,
    });
    return c.json(ok(reqId, clientProfile(data as LineUserRecord)));
  },
);

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

    if (!user.full_name?.trim()) {
      return c.json(fail(reqId, 'LINE_PROFILE_REQUIRED', 'กรุณากรอกชื่อ–นามสกุลก่อนส่ง Ticket'), 400);
    }

    const { data: category } = await admin.from('ticket_categories').select('*').eq('id', body.categoryId).eq('status', 'active').maybeSingle();
    if (!category) return c.json(fail(reqId, 'TICKET_CATEGORY_INVALID', 'กรุณาเลือกหมวดหมู่ Ticket ที่ใช้งานอยู่'), 400);

    let asset: { id: string; name: string } | null = null;
    if (body.assetCode) {
      const byCode = await admin.from('assets').select('id, name').eq('asset_code', body.assetCode).maybeSingle();
      asset = byCode.data;
      if (!asset) {
        const byLegacyId = await admin.from('assets').select('id, name').eq('legacy_id', body.assetCode).maybeSingle();
        asset = byLegacyId.data;
      }
    }

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
        requester_id: user.linked_user_id ?? null,
        requester_name_snapshot: user.full_name,
        requester_position_snapshot: body.requesterPosition ?? null,
        requester_identity_type: 'LINE',
        requester_phone: body.requesterPhone ?? null,
        department_name_snapshot: body.department ?? user.department ?? null,
        incident_at: body.incidentAt ? new Date(body.incidentAt).toISOString() : now.toISOString(),
        erp_module: body.erpModule ?? null,
        location: body.location ?? null,
        asset_id: asset?.id ?? null,
        asset_name_snapshot: asset?.name ?? (body.assetCode || null),
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
        created_by: user.linked_user_id ?? null,
        ...ticketConsentEvidence('PUBLIC_TICKET_LINE', now),
      })
      .select()
      .single();
    if (error || !ticket) return dbFailJson(c, 'TICKET_CREATE_FAILED', error, 'สร้าง Ticket ไม่สำเร็จ');

    await admin.from('ticket_worklogs').insert({
      ticket_id: ticket.id, action: 'เปิด Ticket', status_to: 'ใหม่', detail: 'สร้างผ่าน LINE',
      is_public: true, actor_id: user.linked_user_id ?? null, actor_line_user_id: user.id,
    });
    await writeAuditLog(c.env, {
      actorEmail: `LINE:${user.line_user_id}`, action: 'CREATE', module: 'ticket', targetTable: 'tickets',
      targetId: ticket.id, detail: { title: body.title, categoryId: body.categoryId, channel: 'line' }, requestId: reqId,
    });
    const teamMessage = `Ticket ใหม่จาก LINE: ${ticket.title} (${ticket.ticket_no})`;
    await notifyTicketTeam(c.env, teamMessage, buildTicketFlexMessage({
      eyebrow: 'มีรายการแจ้งซ่อมใหม่',
      title: ticket.title,
      ticketNo: ticket.ticket_no,
      status: ticket.status,
      requesterName: user.full_name,
      detail: ticket.description,
      url: c.env.PUBLIC_APP_URL ? `${c.env.PUBLIC_APP_URL.replace(/\/$/, '')}/tickets/${ticket.id}` : null,
      buttonLabel: 'เปิดรับเรื่อง',
    }));

    return c.json(ok(reqId, ticket), 201);
  },
);

lineRoute.get('/tickets', requireUsableLineSession, async (c) => {
  const reqId = c.get('requestId');
  const { user } = c.get('lineSession')!;
  const admin = createAdminClient(c.env);
  let ticketQuery = admin
    .from('tickets')
    .select('id, ticket_no, title, priority, status, created_at, updated_at, response_due_at, due_at, resolved_at, closed_at, rating, location, assignee_name_snapshot, asset_name_snapshot, category:ticket_categories(name)')
    .order('created_at', { ascending: false })
    .limit(50);
  ticketQuery = user.linked_user_id
    ? ticketQuery.or(`requester_line_user_id.eq.${user.id},requester_id.eq.${user.linked_user_id}`)
    : ticketQuery.eq('requester_line_user_id', user.id);
  const { data, error } = await ticketQuery;
  if (error) return dbFailJson(c, 'LINE_TICKET_LIST_FAILED', error);
  return c.json(ok(reqId, data ?? []));
});

/**
 * ฟีดแจ้งเตือนของผู้แจ้ง สร้างจาก worklog สาธารณะของ Ticket ที่เป็นของบัญชี LINE นี้
 * — ไม่มีตารางแจ้งเตือนแยกสำหรับผู้ใช้ LINE และ worklog คือแหล่งเดียวที่บันทึกว่า
 * ทีม IT ทำอะไรกับใบไปแล้วบ้าง รายการที่ผู้แจ้งเป็นคนทำเองถูกตัดออก เพราะไม่ต้อง
 * เตือนสิ่งที่ตัวเองเพิ่งกดไปเมื่อครู่
 */
lineRoute.get('/notifications', requireUsableLineSession, async (c) => {
  const reqId = c.get('requestId');
  const { user } = c.get('lineSession')!;
  const admin = createAdminClient(c.env);
  let ticketQuery = admin
    .from('tickets')
    .select('id, ticket_no, title')
    .order('created_at', { ascending: false })
    .limit(50);
  ticketQuery = user.linked_user_id
    ? ticketQuery.or(`requester_line_user_id.eq.${user.id},requester_id.eq.${user.linked_user_id}`)
    : ticketQuery.eq('requester_line_user_id', user.id);
  const { data: tickets, error: ticketError } = await ticketQuery;
  if (ticketError) return dbFailJson(c, 'LINE_NOTIFICATION_LIST_FAILED', ticketError);
  if (!tickets?.length) return c.json(ok(reqId, []));

  const ticketById = new Map(tickets.map((ticket) => [ticket.id as string, ticket]));
  const { data: logs, error } = await admin
    .from('ticket_worklogs')
    .select('id, ticket_id, action, detail, status_to, created_at')
    .in('ticket_id', [...ticketById.keys()])
    .eq('is_public', true)
    .is('actor_line_user_id', null)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return dbFailJson(c, 'LINE_NOTIFICATION_LIST_FAILED', error);

  return c.json(ok(reqId, (logs ?? []).flatMap((log) => {
    const ticket = ticketById.get(log.ticket_id as string);
    return ticket ? [{
      id: log.id,
      ticket_id: log.ticket_id,
      ticket_no: ticket.ticket_no,
      ticket_title: ticket.title,
      action: log.action,
      detail: log.detail,
      status_to: log.status_to,
      created_at: log.created_at,
    }] : [];
  })));
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
    const [{ data: worklogs }, { data: ratingCriteria }, { data: attachmentRows }] = await Promise.all([
      admin
      .from('ticket_worklogs')
      .select('id, entry_type, action, detail, status_from, status_to, created_at, actor_line_user_id, actor_label, actor:profiles!ticket_worklogs_actor_id_fkey(full_name)')
      .eq('ticket_id', ticket.id).eq('is_public', true).order('created_at', { ascending: true }),
      admin.from('ticket_rating_criteria').select('id, key, label, description, sort_order, status').eq('status', 'active').order('sort_order').order('created_at'),
      admin
        .from('file_attachments')
        .select('id, storage_path, original_filename, mime_type, size_bytes, created_at')
        .eq('module', 'ticket').eq('target_table', 'tickets').eq('target_id', ticket.id)
        .order('created_at', { ascending: true }),
    ]);
    const attachments = await Promise.all((attachmentRows ?? []).map(async ({ storage_path, ...attachment }) => {
      const signed = await createSignedUrl(admin, storage_path, 600);
      return { ...attachment, signed_url: 'url' in signed ? signed.url : null };
    }));
    // ไม่มีลายเซ็นกลางให้ตกทอดแล้ว — ผู้ร้องเห็นลายเซ็นเฉพาะที่มีคนเซ็นให้ใบนี้จริง
    const signaturePath = ticket.signature_storage_path ? String(ticket.signature_storage_path) : '';
    const requesterSignaturePath = ticket.requester_signature_storage_path ? String(ticket.requester_signature_storage_path) : '';
    let signatureUrl: string | null = null;
    let requesterSignatureUrl: string | null = null;
    if (signaturePath) {
      const { data } = await admin.storage.from('ticket-signatures').createSignedUrl(signaturePath, 3600);
      signatureUrl = data?.signedUrl ?? null;
    }
    if (requesterSignaturePath) {
      const { data } = await admin.storage.from('ticket-signatures').createSignedUrl(requesterSignaturePath, 3600);
      requesterSignatureUrl = data?.signedUrl ?? null;
    }
    return c.json(ok(reqId, { ticket: { ...ticket, signature_url: signatureUrl, requester_signature_url: requesterSignatureUrl }, ratingCriteria: ratingCriteria ?? [], worklogs: worklogs ?? [], attachments }));
  },
);

lineRoute.post(
  '/tickets/:id/attachments',
  requireUsableLineSession,
  rateLimit({ windowMs: 3600_000, max: 20, keyFn: (c) => `line_ticket_attachment:${c.get('lineSession')!.user.id}` }),
  async (c) => {
    const reqId = c.get('requestId');
    const { user } = c.get('lineSession')!;
    const ticketId = c.req.param('id');
    const admin = createAdminClient(c.env);
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, requester_id, requester_line_user_id')
      .eq('id', ticketId)
      .maybeSingle();
    const belongsToLineUser = ticket?.requester_line_user_id === user.id
      || (Boolean(user.linked_user_id) && ticket?.requester_id === user.linked_user_id);
    if (!ticket || !belongsToLineUser) {
      return c.json(fail(reqId, 'LINE_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ในบัญชี LINE ของท่าน'), 404);
    }

    const contentLength = Number(c.req.header('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES + 1024 * 1024) {
      return c.json(fail(reqId, 'FILE_TOO_LARGE', 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB'), 413);
    }
    const { count, error: countError } = await admin
      .from('file_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('module', 'ticket').eq('target_table', 'tickets').eq('target_id', ticket.id);
    if (countError) return dbFailJson(c, 'FILE_ATTACHMENT_COUNT_FAILED', countError, 'ตรวจสอบจำนวนไฟล์ไม่สำเร็จ');
    if ((count ?? 0) >= MAX_LINE_TICKET_ATTACHMENTS) {
      return c.json(fail(reqId, 'FILE_LIMIT_REACHED', `แนบได้สูงสุด ${MAX_LINE_TICKET_ATTACHMENTS} ไฟล์ต่อ Ticket`), 400);
    }

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json(fail(reqId, 'VALIDATION_ERROR', 'กรุณาเลือกไฟล์ที่ต้องการแนบ'), 400);
    if (file.size > MAX_FILE_SIZE_BYTES) return c.json(fail(reqId, 'FILE_TOO_LARGE', 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB'), 413);
    if (!(LINE_TICKET_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
      return c.json(fail(reqId, 'FILE_TYPE_NOT_ALLOWED', 'รองรับเฉพาะ JPG, PNG, GIF, WebP และ PDF'), 400);
    }

    const signature = await verifyFileSignature(file, file.type);
    if (!signature.ok || !signature.resolvedMime) {
      await writeAuditLog(c.env, {
        actorEmail: `LINE:${user.line_user_id}`, action: 'UPLOAD_REJECTED', module: 'file',
        targetTable: 'file_attachments', targetId: ticket.id,
        detail: { filename: file.name, declaredMimeType: file.type, sizeBytes: file.size, reason: signature.reason, channel: 'line' },
        result: 'denied', requestId: reqId,
      });
      return c.json(fail(reqId, 'FILE_CONTENT_MISMATCH', signature.reason ?? 'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่ระบุ'), 400);
    }

    const uploaded = await uploadPublicTicketFile(admin, ticket.id, file, signature.resolvedMime);
    if ('error' in uploaded) return c.json(fail(reqId, 'FILE_UPLOAD_FAILED', uploaded.error), 400);
    const { data: attachment, error: metadataError } = await admin
      .from('file_attachments')
      .insert({
        storage_path: uploaded.path,
        original_filename: file.name,
        mime_type: signature.resolvedMime,
        size_bytes: file.size,
        module: 'ticket',
        target_table: 'tickets',
        target_id: ticket.id,
        uploaded_by: null,
        uploader_label: `ผู้แจ้งผ่าน LINE: ${user.full_name ?? '-'}`,
      })
      .select('id, original_filename, mime_type, size_bytes, created_at')
      .single();
    if (metadataError || !attachment) {
      await deleteFile(admin, uploaded.path);
      return c.json(fail(reqId, 'FILE_METADATA_SAVE_FAILED', 'บันทึกข้อมูลไฟล์ไม่สำเร็จ'), 400);
    }

    await writeAuditLog(c.env, {
      actorEmail: `LINE:${user.line_user_id}`, action: 'UPLOAD', module: 'file',
      targetTable: 'file_attachments', targetId: attachment.id,
      detail: { ticketId: ticket.id, originalFilename: file.name, sizeBytes: file.size, channel: 'line' },
      requestId: reqId,
    });
    const signed = await createSignedUrl(admin, uploaded.path, 600);
    return c.json(ok(reqId, { ...attachment, signed_url: 'url' in signed ? signed.url : null }), 201);
  },
);

/**
 * ข้อความจากผู้แจ้งถึงทีม IT บนใบ Ticket — บันทึกเป็น worklog สาธารณะเพื่อให้ทั้งสองฝั่ง
 * เห็นบทสนทนาเดียวกันในไทม์ไลน์ ไม่แยกเก็บอีกตาราง
 */
lineRoute.post(
  '/tickets/:id/messages',
  requireUsableLineSession,
  rateLimit({ windowMs: 3600_000, max: 60, keyFn: (c) => `line_ticket_message:${c.get('lineSession')!.user.id}` }),
  zValidator('json', lineTicketMessageSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { user } = c.get('lineSession')!;
    const admin = createAdminClient(c.env);
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, ticket_no, title, status, requester_id, requester_line_user_id')
      .eq('id', c.req.param('id'))
      .maybeSingle();
    const belongsToLineUser = ticket?.requester_line_user_id === user.id
      || (Boolean(user.linked_user_id) && ticket?.requester_id === user.linked_user_id);
    if (!ticket || !belongsToLineUser) {
      return c.json(fail(reqId, 'LINE_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ในบัญชี LINE ของท่าน'), 404);
    }
    if (LINE_TICKET_MESSAGE_CLOSED_STATUSES.includes(String(ticket.status))) {
      return c.json(fail(reqId, 'LINE_TICKET_MESSAGE_NOT_ALLOWED', 'Ticket นี้ปิดแล้ว หากยังพบปัญหากรุณาแจ้งเรื่องใหม่'), 400);
    }

    const { message } = c.req.valid('json');
    const { data: worklog, error } = await admin
      .from('ticket_worklogs')
      .insert({
        ticket_id: ticket.id,
        entry_type: 'comment',
        action: 'ข้อความสนทนา',
        detail: message,
        is_public: true,
        actor_id: user.linked_user_id ?? null,
        actor_line_user_id: user.id,
      })
      .select('id, entry_type, action, detail, status_from, status_to, created_at, actor_line_user_id, actor_label')
      .single();
    if (error || !worklog) return dbFailJson(c, 'LINE_TICKET_MESSAGE_FAILED', error, 'ส่งข้อความไม่สำเร็จ');

    await writeAuditLog(c.env, {
      actorEmail: `LINE:${user.line_user_id}`, action: 'CREATE', module: 'ticket',
      targetTable: 'ticket_worklogs', targetId: String(worklog.id),
      detail: { ticketId: ticket.id, channel: 'line' }, requestId: reqId,
    });
    await notifyTicketTeam(c.env, `ข้อความใหม่จากผู้แจ้ง (${ticket.ticket_no}): ${message}`, buildTicketFlexMessage({
      eyebrow: 'ผู้แจ้งส่งข้อความใหม่',
      title: ticket.title,
      ticketNo: ticket.ticket_no,
      status: ticket.status,
      requesterName: user.full_name,
      detail: message,
      url: c.env.PUBLIC_APP_URL ? `${c.env.PUBLIC_APP_URL.replace(/\/$/, '')}/tickets/${ticket.id}` : null,
      buttonLabel: 'ตอบกลับผู้แจ้ง',
    }));
    return c.json(ok(reqId, worklog), 201);
  },
);

lineRoute.post(
  '/tickets/:id/signoff',
  requireUsableLineSession,
  rateLimit({ windowMs: 3600_000, max: 8, keyFn: (c) => `line_ticket_signature:${c.get('lineSession')!.user.id}` }),
  async (c) => {
    const reqId = c.get('requestId');
    const { user } = c.get('lineSession')!;
    const admin = createAdminClient(c.env);
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, ticket_no, title, status, requester_id, requester_line_user_id, requester_signature_storage_path')
      .eq('id', c.req.param('id'))
      .maybeSingle();
    const belongsToLineUser = ticket?.requester_line_user_id === user.id
      || (Boolean(user.linked_user_id) && ticket?.requester_id === user.linked_user_id);
    if (!ticket || !belongsToLineUser) {
      return c.json(fail(reqId, 'LINE_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ในบัญชี LINE ของท่าน'), 404);
    }
    if (ticket.status !== 'เสร็จสิ้น') {
      return c.json(fail(reqId, 'TICKET_SIGNOFF_NOT_READY', 'ลงลายเซ็นตรวจรับได้เมื่อช่างดำเนินงานเสร็จสิ้นแล้วเท่านั้น'), 409);
    }

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json(fail(reqId, 'TICKET_SIGNATURE_REQUIRED', 'กรุณาเพิ่มลายเซ็นผู้แจ้ง'), 400);
    let ratingsPayload: unknown;
    try {
      ratingsPayload = typeof body.ratings === 'string' ? JSON.parse(body.ratings) : null;
    } catch {
      return c.json(fail(reqId, 'LINE_TICKET_RATING_INVALID', 'ข้อมูลแบบประเมินไม่ถูกต้อง กรุณาให้คะแนนใหม่'), 400);
    }
    const evaluation = lineTicketFeedbackSchema.safeParse({
      ratings: ratingsPayload,
      comment: typeof body.feedback === 'string' ? body.feedback : undefined,
    });
    if (!evaluation.success) {
      return c.json(fail(reqId, 'LINE_TICKET_RATING_INVALID', evaluation.error.issues[0]?.message ?? 'กรุณาให้คะแนนให้ครบทุกหัวข้อ'), 400);
    }
    const { data: criteria, error: criteriaError } = await admin
      .from('ticket_rating_criteria')
      .select('key, label')
      .eq('status', 'active')
      .order('sort_order')
      .order('created_at');
    if (criteriaError || !criteria?.length) {
      return c.json(fail(reqId, 'LINE_TICKET_RATING_CRITERIA_UNAVAILABLE', 'ไม่พบหัวข้อประเมินที่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ'), 409);
    }
    if (!ratingsMatchCriteria(evaluation.data.ratings, criteria.map((criterion) => String(criterion.key)))) {
      return c.json(fail(reqId, 'LINE_TICKET_RATING_CRITERIA_CHANGED', 'หัวข้อประเมินมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่'), 409);
    }
    const rating = calculateTicketOverallRating(evaluation.data.ratings);
    const ratingSnapshot = criteria.map((criterion) => ({
      key: String(criterion.key),
      label: String(criterion.label),
      score: evaluation.data.ratings[String(criterion.key)],
    }));
    const saved = await saveRequesterSignature(admin, {
      ticketId: ticket.id,
      previousPath: ticket.requester_signature_storage_path,
      file,
      uploadedBy: user.linked_user_id ?? null,
    });
    if (!saved.ok) return c.json(fail(reqId, saved.code, saved.message), 400);

    const { error: closeError } = await admin.from('tickets').update({
      status: 'ปิดงาน',
      closed_at: saved.uploadedAt,
      rating,
      rating_details: evaluation.data.ratings,
      rating_criteria_snapshot: ratingSnapshot,
      feedback: evaluation.data.comment ?? null,
      feedback_at: saved.uploadedAt,
    }).eq('id', ticket.id).eq('status', 'เสร็จสิ้น');
    if (closeError) return dbFailJson(c, 'TICKET_REQUESTER_SIGNOFF_FAILED', closeError, 'บันทึกการตรวจรับงานไม่สำเร็จ');
    await admin.from('ticket_worklogs').insert({
      ticket_id: ticket.id, action: 'ผู้แจ้งประเมิน ตรวจรับ และลงนาม', detail: `ผู้แจ้งประเมิน ${rating}/5 คะแนน ยืนยันผลการแก้ไข และลงลายเซ็นในส่วนที่ 5`,
      status_from: 'เสร็จสิ้น', status_to: 'ปิดงาน', is_public: true,
      actor_id: user.linked_user_id ?? null, actor_line_user_id: user.id,
    });

    await writeAuditLog(c.env, {
      actorEmail: `LINE:${user.line_user_id}`, action: 'REQUESTER_SIGNOFF', module: 'ticket', targetTable: 'tickets',
      targetId: ticket.id, detail: { channel: 'line', signer: user.full_name, sizeBytes: file.size, status: 'ปิดงาน', rating, ratings: evaluation.data.ratings }, requestId: reqId,
    });
    const teamMessage = `ผู้แจ้งผ่าน LINE ประเมิน ตรวจรับ และลงนามปิด ${ticket.ticket_no}: ${ticket.title}`;
    await notifyTicketTeam(c.env, teamMessage, buildTicketFlexMessage({
      eyebrow: 'ผู้แจ้งตรวจรับและปิดงานแล้ว',
      title: ticket.title,
      ticketNo: ticket.ticket_no,
      status: 'ปิดงาน',
      requesterName: user.full_name,
      detail: `ผลประเมินรวม ${rating}/5 คะแนน`,
      url: c.env.PUBLIC_APP_URL ? `${c.env.PUBLIC_APP_URL.replace(/\/$/, '')}/tickets/${ticket.id}` : null,
    }));
    return c.json(ok(reqId, { signatureUrl: saved.signatureUrl, uploadedAt: saved.uploadedAt, status: 'ปิดงาน', rating }), 201);
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
 * Staff-facing LINE account administration. These routes use Supabase auth and line.manage;
 * public LINE sessions above never receive access to the profile directory or link controls.
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

lineRoute.get(
  '/admin/link-options', requireAuth, requirePermission('line.manage'),
  async (c) => {
    const reqId = c.get('requestId');
    const admin = createAdminClient(c.env);
    const [{ data: profiles, error: profilesError }, { data: links, error: linksError }] = await Promise.all([
      admin
        .from('profiles')
        .select('id, employee_code, full_name, email, status')
        .order('full_name')
        .limit(1000),
      admin
        .from('line_users')
        .select('id, linked_user_id')
        .not('linked_user_id', 'is', null),
    ]);
    if (profilesError || linksError) {
      return dbFailJson(c, 'LINE_ADMIN_LINK_OPTIONS_FAILED', profilesError ?? linksError, 'โหลดรายชื่อผู้ใช้สำหรับเชื่อม LINE ไม่สำเร็จ');
    }
    const linkedLineIdByUserId = new Map(
      (links ?? []).map((link) => [String(link.linked_user_id), String(link.id)]),
    );
    return c.json(ok(reqId, (profiles ?? []).map((profile) => ({
      ...profile,
      linked_line_user_id: linkedLineIdByUserId.get(String(profile.id)) ?? null,
    }))));
  },
);

lineRoute.patch(
  '/admin/links/:id/link', requireAuth, requirePermission('line.manage'),
  zValidator('json', lineAdminUpdateLinkSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const lineUserId = c.req.param('id');
    const { userId } = c.req.valid('json');
    const admin = createAdminClient(c.env);
    const { data: current, error: currentError } = await admin
      .from('line_users')
      .select('*')
      .eq('id', lineUserId)
      .maybeSingle();
    if (currentError) return dbFailJson(c, 'LINE_ADMIN_LOAD_FAILED', currentError);
    if (!current) return c.json(fail(reqId, 'LINE_USER_NOT_FOUND', 'ไม่พบบัญชี LINE นี้'), 404);

    let targetProfile: { id: string; employee_code: string | null; full_name: string | null; status: string } | null = null;
    if (userId) {
      const { data, error } = await admin
        .from('profiles')
        .select('id, employee_code, full_name, status')
        .eq('id', userId)
        .maybeSingle();
      if (error) return dbFailJson(c, 'LINE_ADMIN_PROFILE_LOAD_FAILED', error);
      if (!data) return c.json(fail(reqId, 'LINE_PROFILE_NOT_FOUND', 'ไม่พบผู้ใช้ที่เลือก'), 404);
      if (data.status !== 'active') {
        return c.json(fail(reqId, 'LINE_PROFILE_INACTIVE', 'เชื่อม LINE ได้เฉพาะผู้ใช้สถานะ Active'), 409);
      }
      targetProfile = data;

      const { data: duplicate, error: duplicateError } = await admin
        .from('line_users')
        .select('id')
        .eq('linked_user_id', userId)
        .neq('id', lineUserId)
        .maybeSingle();
      if (duplicateError) return dbFailJson(c, 'LINE_ADMIN_DUPLICATE_CHECK_FAILED', duplicateError);
      if (duplicate) {
        return c.json(fail(reqId, 'LINE_PROFILE_ALREADY_LINKED', 'ผู้ใช้นี้เชื่อมกับบัญชี LINE อื่นแล้ว กรุณายกเลิกการเชื่อมเดิมก่อน'), 409);
      }
    }

    const { data: updated, error } = await admin
      .from('line_users')
      .update({
        linked_user_id: targetProfile?.id ?? null,
        employee_code: targetProfile?.employee_code ?? null,
        // A linked system profile is the authoritative source for the employee's real name.
        // Unlinking keeps the already confirmed name so future LINE tickets remain identifiable.
        full_name: targetProfile?.full_name ?? current.full_name,
        updated_by: c.get('userId'),
      })
      .eq('id', lineUserId)
      .select('*')
      .maybeSingle();
    if (error) {
      const message = error.code === '23505'
        ? 'ผู้ใช้นี้เชื่อมกับบัญชี LINE อื่นแล้ว'
        : 'บันทึกการเชื่อมบัญชี LINE ไม่สำเร็จ';
      return dbFailJson(c, 'LINE_ADMIN_LINK_FAILED', error, message);
    }
    if (!updated) return c.json(fail(reqId, 'LINE_USER_NOT_FOUND', 'ไม่พบบัญชี LINE นี้'), 404);

    if (targetProfile?.full_name) {
      const { error: ticketNameError } = await admin
        .from('tickets')
        .update({ requester_name_snapshot: targetProfile.full_name })
        .eq('requester_line_user_id', updated.id)
        .in('status', ['ใหม่', 'รับเรื่องแล้ว', 'กำลังดำเนินการ', 'รออะไหล่', 'รอผู้ใช้งาน', 'ส่งต่อ Outsource', 'เสร็จสิ้น']);
      if (ticketNameError) return dbFailJson(c, 'LINE_TICKET_REQUESTER_NAME_UPDATE_FAILED', ticketNameError, 'อัปเดตชื่อผู้แจ้งใน Ticket ไม่สำเร็จ');
    }

    await writeAuditLog(c.env, {
      actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: userId ? 'LINE_ADMIN_LINK_USER' : 'LINE_ADMIN_UNLINK_USER',
      module: 'line', targetTable: 'line_users', targetId: updated.id,
      detail: { previousUserId: current.linked_user_id, linkedUserId: userId, linkedUserName: targetProfile?.full_name ?? null },
      requestId: reqId, before: current, after: updated,
    });
    return c.json(ok(reqId, updated));
  },
);

lineRoute.post(
  '/admin/links/:id/test-message', requireAuth, requirePermission('line.manage'),
  async (c) => {
    const reqId = c.get('requestId');
    const admin = createAdminClient(c.env);
    const { data: account, error } = await admin
      .from('line_users')
      .select('id, line_user_id, display_name, full_name, link_status')
      .eq('id', c.req.param('id'))
      .maybeSingle();
    if (error) return dbFailJson(c, 'LINE_ADMIN_LOAD_FAILED', error);
    if (!account) return c.json(fail(reqId, 'LINE_USER_NOT_FOUND', 'ไม่พบบัญชี LINE นี้'), 404);
    if (account.link_status !== 'Active') {
      return c.json(fail(reqId, 'LINE_ACCOUNT_NOT_ACTIVE', 'ส่งข้อความทดสอบได้เฉพาะบัญชี LINE ที่ Active'), 409);
    }

    const testTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const testMessage = `ข้อความทดสอบจาก LIFE IT Smart Service Center\nเวลา ${testTime}`;
    const result = await sendLinePush(
      c.env,
      account.line_user_id,
      testMessage,
      account.id,
      buildTicketFlexMessage({
        eyebrow: 'ทดสอบการแจ้งเตือนสำเร็จ',
        title: 'บัญชีนี้พร้อมรับข้อความจาก LIFE IT',
        requesterName: account.full_name ?? account.display_name,
        detail: `ส่งเมื่อ ${testTime}`,
        url: c.env.PUBLIC_APP_URL ? `${c.env.PUBLIC_APP_URL.replace(/\/$/, '')}/line?mode=status` : null,
        buttonLabel: 'เปิด LINE Service Portal',
        accentColor: '#06A66A',
      }),
    );
    await writeAuditLog(c.env, {
      actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'LINE_ADMIN_TEST_MESSAGE',
      module: 'line', targetTable: 'line_users', targetId: account.id,
      detail: { success: result.success, error: result.error?.slice(0, 200) ?? null }, requestId: reqId,
    });
    if (!result.success) {
      return c.json(fail(reqId, 'LINE_TEST_MESSAGE_FAILED', 'LINE Messaging API ปฏิเสธข้อความทดสอบ กรุณาตรวจ token และสถานะเพื่อน LINE OA'), 502);
    }
    return c.json(ok(reqId, { sent: true, accountName: account.full_name ?? account.display_name ?? null }));
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
