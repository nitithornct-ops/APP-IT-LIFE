import { zValidator } from '@hono/zod-validator';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { randomToken } from '../lib/lineAuth';
import { createAdminClient } from '../lib/supabase';
import { hashVendorSessionToken, verifyVendorPassword } from '../lib/vendorPortalAuth';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv, VendorPortalProfile } from '../types';
import { dbFailJson } from '../utils/dbError';
import { verifyFileSignature } from '../utils/fileSignature';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  reviewOutsourceSubmissionSchema,
  submitOutsourceWorkSchema,
  vendorPortalLoginSchema,
} from '../validators/vendorPortal';

const VENDOR_SESSION_HOURS = 12;
const VENDOR_SIGNATURE_BUCKET = 'ticket-outsource-signatures';
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const SAFE_TICKET_SELECT =
  'id, ticket_no, title, description, priority, status, location, created_at, outsource_issue_no, outsource_sent_at, ' +
  'ticket_categories(name)';

interface VendorSessionContext {
  token: string;
  profile: VendorPortalProfile;
}

interface SafeVendorTicketRow {
  id: string;
  ticket_no: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  location: string | null;
  created_at: string;
  outsource_issue_no: string | null;
  outsource_sent_at: string | null;
  ticket_categories: { name: string | null } | null;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadVendorSession(c: Context<AppEnv>): Promise<VendorSessionContext | null> {
  const token = c.req.header('x-vendor-session') ?? '';
  if (!/^[0-9a-f]{64}$/i.test(token)) return null;
  const admin = createAdminClient(c.env);
  const sessionHash = await hashVendorSessionToken(token);
  const { data: session } = await admin
    .from('vendor_portal_sessions')
    .select('id, account_id, expires_at, revoked_at, last_seen_at')
    .eq('session_hash', sessionHash)
    .maybeSingle();
  if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) return null;

  const { data: account } = await admin
    .from('vendor_portal_accounts')
    .select('id, vendor_id, email, full_name, position, status')
    .eq('id', session.account_id)
    .eq('status', 'Active')
    .maybeSingle();
  if (!account) return null;
  const { data: vendor } = await admin
    .from('vendors')
    .select('id, vendor_code, name, status')
    .eq('id', account.vendor_id)
    .eq('status', 'Active')
    .maybeSingle();
  if (!vendor) return null;

  const lastSeen = Date.parse(session.last_seen_at);
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 5 * 60_000) {
    await admin.from('vendor_portal_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id);
  }
  return {
    token,
    profile: {
      accountId: account.id,
      vendorId: vendor.id,
      vendorCode: vendor.vendor_code,
      vendorName: vendor.name,
      email: account.email,
      fullName: account.full_name,
      position: account.position,
    },
  };
}

const requireVendorSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await loadVendorSession(c);
  if (!session) return c.json(fail(c.get('requestId'), 'VENDOR_SESSION_REQUIRED', 'Session บริษัทหมดอายุ กรุณาเข้าสู่ระบบใหม่'), 401);
  c.set('vendorSession', session);
  await next();
};

async function latestSubmission(admin: ReturnType<typeof createAdminClient>, ticketId: string) {
  const { data } = await admin
    .from('ticket_outsource_submissions')
    .select('id, ticket_id, vendor_id, revision, response, signature_storage_path, signer_name, signer_position, submitted_at, review_status, reviewed_at, review_note')
    .eq('ticket_id', ticketId)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function submissionWithSignature(admin: ReturnType<typeof createAdminClient>, submission: Awaited<ReturnType<typeof latestSubmission>>) {
  if (!submission) return null;
  const { data } = await admin.storage.from(VENDOR_SIGNATURE_BUCKET).createSignedUrl(submission.signature_storage_path, 3600);
  return { ...submission, signature_url: data?.signedUrl ?? null };
}

export const vendorPortalRoute = new Hono<AppEnv>();

vendorPortalRoute.get('/bootstrap', (c) => c.json(ok(c.get('requestId'), { enabled: true })));

vendorPortalRoute.post(
  '/login',
  edgeRateLimit({ keyFn: (c) => `vendor_login:${clientIp(c)}` }),
  rateLimit({ windowMs: 15 * 60_000, max: 20, keyFn: (c) => `vendor_login:${clientIp(c)}` }),
  zValidator('json', vendorPortalLoginSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const body = c.req.valid('json');
    const admin = createAdminClient(c.env);
    const invalid = () => c.json(fail(reqId, 'VENDOR_LOGIN_FAILED', 'รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง'), 401);
    const { data: vendor } = await admin.from('vendors').select('id, vendor_code, name, status').eq('vendor_code', body.vendorCode).eq('status', 'Active').maybeSingle();
    if (!vendor) return invalid();
    const { data: account } = await admin
      .from('vendor_portal_accounts')
      .select('id, vendor_id, email, full_name, position, password_hash, status, failed_login_count, locked_until')
      .eq('vendor_id', vendor.id)
      .eq('email', body.email)
      .eq('status', 'Active')
      .maybeSingle();
    if (!account) return invalid();
    if (account.locked_until && Date.parse(account.locked_until) > Date.now()) {
      return c.json(fail(reqId, 'VENDOR_ACCOUNT_LOCKED', 'บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลังหรือติดต่อเจ้าหน้าที่ IT'), 429);
    }
    const validPassword = await verifyVendorPassword(body.password, account.password_hash);
    if (!validPassword) {
      const { error: failureError } = await admin.rpc('register_vendor_portal_login_failure', {
        account_id_input: account.id,
        failed_at_input: new Date().toISOString(),
      });
      if (failureError) return dbFailJson(c, 'VENDOR_LOGIN_COUNTER_FAILED', failureError, 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ');
      return invalid();
    }

    const token = randomToken();
    const now = new Date();
    // Re-check the lock atomically after password verification. A concurrent failed request may
    // have crossed the threshold while PBKDF2 was running, in which case this login must not win.
    const { data: loginAllowed, error: successError } = await admin.rpc('register_vendor_portal_login_success', {
      account_id_input: account.id,
      login_at_input: now.toISOString(),
    });
    if (successError) return dbFailJson(c, 'VENDOR_LOGIN_COUNTER_FAILED', successError, 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ');
    if (loginAllowed !== true) {
      return c.json(fail(reqId, 'VENDOR_ACCOUNT_LOCKED', 'บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลังหรือติดต่อเจ้าหน้าที่ IT'), 429);
    }
    const { error: sessionError } = await admin.from('vendor_portal_sessions').insert({
      account_id: account.id,
      session_hash: await hashVendorSessionToken(token),
      expires_at: new Date(now.getTime() + VENDOR_SESSION_HOURS * 3600_000).toISOString(),
      ip_hash: await sha256(clientIp(c)),
      user_agent: (c.req.header('user-agent') ?? '').slice(0, 500) || null,
    });
    if (sessionError) return dbFailJson(c, 'VENDOR_SESSION_CREATE_FAILED', sessionError, 'เข้าสู่ระบบไม่สำเร็จ');
    const profile: VendorPortalProfile = {
      accountId: account.id,
      vendorId: vendor.id,
      vendorCode: vendor.vendor_code,
      vendorName: vendor.name,
      email: account.email,
      fullName: account.full_name,
      position: account.position,
    };
    await writeAuditLog(c.env, { actorEmail: `VENDOR:${account.email}`, action: 'LOGIN', module: 'vendor_portal', targetTable: 'vendor_portal_accounts', targetId: account.id, detail: { vendorId: vendor.id }, requestId: reqId });
    return c.json(ok(reqId, { token, profile, expiresInHours: VENDOR_SESSION_HOURS }));
  },
);

vendorPortalRoute.use('/me', requireVendorSession);
vendorPortalRoute.use('/logout', requireVendorSession);
vendorPortalRoute.use('/tickets/*', requireVendorSession);
vendorPortalRoute.use('/tickets', requireVendorSession);

vendorPortalRoute.get('/me', (c) => c.json(ok(c.get('requestId'), c.get('vendorSession')!.profile)));

vendorPortalRoute.post('/logout', async (c) => {
  const { token } = c.get('vendorSession')!;
  await createAdminClient(c.env).from('vendor_portal_sessions').update({ revoked_at: new Date().toISOString() }).eq('session_hash', await hashVendorSessionToken(token));
  return c.json(ok(c.get('requestId'), { loggedOut: true }));
});

vendorPortalRoute.get('/tickets', async (c) => {
  const reqId = c.get('requestId');
  const { profile } = c.get('vendorSession')!;
  const admin = createAdminClient(c.env);
  const { data: tickets, error } = await admin.from('tickets').select(SAFE_TICKET_SELECT)
    .eq('outsource_vendor_id', profile.vendorId)
    .eq('status', 'ส่งต่อ Outsource')
    .order('outsource_sent_at', { ascending: false })
    .limit(200);
  if (error) return dbFailJson(c, 'VENDOR_TICKET_LIST_FAILED', error, 'โหลดรายการงานไม่สำเร็จ');
  const ticketRows = (tickets ?? []) as unknown as SafeVendorTicketRow[];
  const ids = ticketRows.map((ticket) => ticket.id);
  const { data: submissions } = ids.length
    ? await admin.from('ticket_outsource_submissions').select('ticket_id, revision, submitted_at, review_status, review_note').in('ticket_id', ids).order('revision', { ascending: false })
    : { data: [] };
  const latestByTicket = new Map<string, unknown>();
  for (const submission of submissions ?? []) {
    if (!latestByTicket.has(submission.ticket_id)) latestByTicket.set(submission.ticket_id, submission);
  }
  return c.json(ok(reqId, ticketRows.map((ticket) => ({ ...ticket, latest_submission: latestByTicket.get(ticket.id) ?? null }))));
});

vendorPortalRoute.get('/tickets/:id', async (c) => {
  const reqId = c.get('requestId');
  const { profile } = c.get('vendorSession')!;
  const admin = createAdminClient(c.env);
  const { data: ticket, error } = await admin.from('tickets').select(SAFE_TICKET_SELECT)
    .eq('id', c.req.param('id'))
    .eq('outsource_vendor_id', profile.vendorId)
    .eq('status', 'ส่งต่อ Outsource')
    .maybeSingle();
  if (error) return dbFailJson(c, 'VENDOR_TICKET_LOAD_FAILED', error, 'โหลดรายละเอียดงานไม่สำเร็จ');
  if (!ticket) return c.json(fail(reqId, 'VENDOR_TICKET_NOT_FOUND', 'ไม่พบงานที่บริษัทได้รับมอบหมาย'), 404);
  const ticketRow = ticket as unknown as SafeVendorTicketRow;
  const submission = await submissionWithSignature(admin, await latestSubmission(admin, ticketRow.id));
  return c.json(ok(reqId, { ticket: ticketRow, submission }));
});

vendorPortalRoute.post(
  '/tickets/:id/submit',
  rateLimit({ windowMs: 3600_000, max: 10, keyFn: (c) => `vendor_submit:${c.get('vendorSession')!.profile.accountId}` }),
  async (c) => {
    const reqId = c.get('requestId');
    const { profile } = c.get('vendorSession')!;
    const admin = createAdminClient(c.env);
    const { data: ticket } = await admin.from('tickets')
      .select('id, ticket_no, title, status, outsource_vendor_id, outsource_issue_no, assignee_id')
      .eq('id', c.req.param('id'))
      .eq('outsource_vendor_id', profile.vendorId)
      .eq('status', 'ส่งต่อ Outsource')
      .maybeSingle();
    if (!ticket) return c.json(fail(reqId, 'VENDOR_TICKET_NOT_FOUND', 'ไม่พบงานที่บริษัทได้รับมอบหมาย'), 404);

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json(fail(reqId, 'VENDOR_SIGNATURE_REQUIRED', 'กรุณาลงลายเซ็นบริษัท'), 400);
    if (file.type !== 'image/png' || file.size > MAX_SIGNATURE_BYTES) {
      return c.json(fail(reqId, 'VENDOR_SIGNATURE_INVALID', 'ลายเซ็นต้องเป็นไฟล์ PNG ขนาดไม่เกิน 2 MB'), 400);
    }
    const fileCheck = await verifyFileSignature(file, 'image/png');
    if (!fileCheck.ok) return c.json(fail(reqId, 'VENDOR_SIGNATURE_INVALID', fileCheck.reason ?? 'เนื้อหาไฟล์ลายเซ็นไม่ถูกต้อง'), 400);
    let payload: unknown;
    try {
      payload = typeof body.payload === 'string' ? JSON.parse(body.payload) : null;
    } catch {
      return c.json(fail(reqId, 'VENDOR_RESPONSE_INVALID', 'ข้อมูลผลการดำเนินงานไม่ถูกต้อง'), 400);
    }
    const parsed = submitOutsourceWorkSchema.safeParse(payload);
    if (!parsed.success) return c.json(fail(reqId, 'VENDOR_RESPONSE_INVALID', parsed.error.issues[0]?.message ?? 'กรุณากรอกข้อมูลให้ครบ'), 400);

    const previous = await latestSubmission(admin, ticket.id);
    if (previous && previous.review_status !== 'Revision Requested') {
      return c.json(fail(reqId, 'VENDOR_RESPONSE_ALREADY_SUBMITTED', 'บริษัทส่งผลการดำเนินงานแล้ว กรุณารอเจ้าหน้าที่ IT ตรวจรับ'), 409);
    }
    const revision = Number(previous?.revision ?? 0) + 1;
    const submittedAt = new Date().toISOString();
    const response = { ...parsed.data, submittedAt };
    const path = `${profile.vendorId}/${ticket.id}/${crypto.randomUUID()}.png`;
    const { error: uploadError } = await admin.storage.from(VENDOR_SIGNATURE_BUCKET).upload(path, file, { contentType: 'image/png', cacheControl: '3600', upsert: false });
    if (uploadError) return c.json(fail(reqId, 'VENDOR_SIGNATURE_UPLOAD_FAILED', 'อัปโหลดลายเซ็นบริษัทไม่สำเร็จ'), 400);
    const { data: submission, error: saveError } = await admin.from('ticket_outsource_submissions').insert({
      ticket_id: ticket.id,
      vendor_id: profile.vendorId,
      account_id: profile.accountId,
      revision,
      response,
      signature_storage_path: path,
      signer_name: parsed.data.assessorName,
      signer_position: parsed.data.assessorPosition || profile.position,
      submitted_at: submittedAt,
    }).select('id, ticket_id, revision, response, signer_name, signer_position, submitted_at, review_status').single();
    if (saveError || !submission) {
      await admin.storage.from(VENDOR_SIGNATURE_BUCKET).remove([path]);
      return dbFailJson(c, 'VENDOR_RESPONSE_SAVE_FAILED', saveError, 'บันทึกผลการดำเนินงานไม่สำเร็จ');
    }
    if (parsed.data.vendorIssueNo && parsed.data.vendorIssueNo !== ticket.outsource_issue_no) {
      await admin.from('tickets').update({ outsource_issue_no: parsed.data.vendorIssueNo }).eq('id', ticket.id);
    }
    await admin.from('ticket_worklogs').insert({
      ticket_id: ticket.id,
      action: 'บริษัทส่งผลการดำเนินงานและลงนาม',
      detail: `${profile.vendorName} ส่งผลการดำเนินงานส่วนที่ 3 ฉบับที่ ${revision}`,
      status_from: ticket.status,
      status_to: ticket.status,
      is_public: true,
      actor_label: `${profile.fullName} · ${profile.vendorName}`,
    });
    if (ticket.assignee_id) {
      await sendNotification(c.env, { recipientId: ticket.assignee_id, type: 'ticket_outsource_response', title: `${ticket.ticket_no} บริษัทส่งผลการดำเนินงานแล้ว`, body: `${profile.vendorName} ลงนามและส่งส่วนที่ 3 เพื่อรอตรวจรับ`, link: `/tickets/${ticket.id}/form` });
    }
    await writeAuditLog(c.env, { actorEmail: `VENDOR:${profile.email}`, action: 'SUBMIT', module: 'vendor_portal', targetTable: 'ticket_outsource_submissions', targetId: submission.id, detail: { ticketId: ticket.id, vendorId: profile.vendorId, revision }, requestId: reqId });
    return c.json(ok(reqId, submission), 201);
  },
);

export const outsourceAdminRoute = new Hono<AppEnv>();
outsourceAdminRoute.use('*', requireAuth);
outsourceAdminRoute.use('*', requirePermission('ticket.view'));

outsourceAdminRoute.get('/:ticketId', async (c) => {
  const ticketId = c.req.param('ticketId')!;
  const { data: visibleTicket } = await c.get('supabase').from('tickets').select('id').eq('id', ticketId).maybeSingle();
  if (!visibleTicket) return c.json(fail(c.get('requestId'), 'TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  const admin = createAdminClient(c.env);
  const submission = await submissionWithSignature(admin, await latestSubmission(admin, ticketId));
  return c.json(ok(c.get('requestId'), submission));
});

outsourceAdminRoute.post('/:ticketId/review', requirePermission('ticket.update'), zValidator('json', reviewOutsourceSubmissionSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const admin = createAdminClient(c.env);
  const body = c.req.valid('json');
  const current = await latestSubmission(admin, c.req.param('ticketId')!);
  if (!current) return c.json(fail(reqId, 'OUTSOURCE_SUBMISSION_NOT_FOUND', 'ยังไม่พบผลการดำเนินงานจากบริษัท'), 404);
  if (current.review_status !== 'Submitted') return c.json(fail(reqId, 'OUTSOURCE_SUBMISSION_ALREADY_REVIEWED', 'ผลการดำเนินงานนี้ถูกตรวจรับแล้ว'), 409);
  const reviewedAt = new Date().toISOString();
  const { data, error } = await admin.from('ticket_outsource_submissions').update({
    review_status: body.status,
    review_note: body.note || null,
    reviewed_by: actorId,
    reviewed_at: reviewedAt,
  }).eq('id', current.id).eq('review_status', 'Submitted').select('id, revision, review_status, reviewed_at, review_note').maybeSingle();
  if (error) return dbFailJson(c, 'OUTSOURCE_SUBMISSION_REVIEW_FAILED', error, 'บันทึกผลตรวจรับไม่สำเร็จ');
  if (!data) return c.json(fail(reqId, 'OUTSOURCE_SUBMISSION_ALREADY_REVIEWED', 'ผลการดำเนินงานนี้ถูกตรวจรับแล้ว'), 409);
  const response = current.response as Record<string, unknown>;
  if (body.status === 'Accepted') {
    await admin.from('tickets').update({
      root_cause: typeof response.rootCause === 'string' ? response.rootCause : null,
      resolution: typeof response.resolution === 'string' ? response.resolution : null,
      updated_by: actorId,
    }).eq('id', c.req.param('ticketId')).eq('status', 'ส่งต่อ Outsource');
  }
  await admin.from('ticket_worklogs').insert({
    ticket_id: c.req.param('ticketId'),
    action: body.status === 'Accepted' ? 'IT ตรวจรับผลจากบริษัท' : 'IT ส่งผลกลับให้บริษัทแก้ไข',
    detail: body.note || (body.status === 'Accepted' ? 'ตรวจรับส่วนที่ 3 เรียบร้อย' : 'กรุณาตรวจสอบและส่งข้อมูลใหม่'),
    is_public: true,
    actor_id: actorId,
  });
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'REVIEW', module: 'vendor_portal', targetTable: 'ticket_outsource_submissions', targetId: current.id, detail: { status: body.status, revision: current.revision }, requestId: reqId });
  return c.json(ok(reqId, data));
});

export { VENDOR_SIGNATURE_BUCKET };
