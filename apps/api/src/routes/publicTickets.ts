import { zValidator } from '@hono/zod-validator';
import { calculateTicketOverallRating } from '@itlife/shared';
import { Hono } from 'hono';
import { appUrl, buildTicketFlexMessage, formatThaiDateTime, notifyTicketTeam } from '../lib/lineMessaging';
import { TICKET_PRIVACY_NOTICE, ticketConsentEvidence } from '../lib/privacyNotice';
import { createAdminClient } from '../lib/supabase';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import { createSignedUrl, deleteFile, uploadPublicTicketFile } from '../services/storageService';
import { addTicketBusinessHours, parseTicketBusinessCalendar } from '../services/ticketSlaService';
import { saveRequesterSignature } from '../services/ticketSignatureService';
import { verifyPublicTicketTurnstile } from '../services/turnstileService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { verifyFileSignature } from '../utils/fileSignature';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { publicSubmitTicketSchema, publicTicketMessageSchema, publicTicketStatusQuerySchema } from '../validators/publicTickets';
import { submitTicketFeedbackSchema } from '../validators/tickets';
import { MAX_FILE_SIZE_BYTES } from '../validators/files';
import { ratingsMatchCriteria } from './tickets';

/**
 * Public (no-login) ticket report page — port of legacy-gas/PublicTicket.html's "แจ้งซ่อม" +
 * "ติดตามสถานะ" tabs. Anyone can submit with just a typed name, no LINE and no Supabase account
 * (see supabase/migrations/20260831100000_public_guest_tickets.sql). Every route here runs on the
 * service-role client with its own validation/rate-limiting instead of RLS, the same pattern
 * routes/line.ts established — there is no Supabase JWT or LINE session to authorize against.
 */
export const publicTicketsRoute = new Hono<AppEnv>();

const PRIORITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;
const TRACKING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PUBLIC_TICKET_ATTACHMENTS = 5;
const PUBLIC_TICKET_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'] as const;
/** ใบที่จบแล้วไม่รับข้อความใหม่ — ผู้แจ้งต้องเปิดเรื่องใหม่ เหมือนกฎฝั่ง LINE และฝั่งพนักงาน */
const PUBLIC_TICKET_CONVERSATION_LOCKED_STATUSES = ['ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'];

function normalizeTrackingToken(token: string): string {
  const compact = token.trim().replaceAll('-', '');
  return /^[0-9a-f]{64}$/i.test(compact) ? compact.toLowerCase() : compact.toUpperCase();
}

export function generateTrackingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const compact = [...bytes].map((byte) => TRACKING_CODE_ALPHABET[byte % TRACKING_CODE_ALPHABET.length]).join('');
  return compact.match(/.{1,4}/g)!.join('-');
}

async function hashTrackingToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeTrackingToken(token)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function formEnabled(env: AppEnv['Bindings']): boolean {
  return env.PUBLIC_TICKET_FORM_ENABLED !== 'false';
}

async function loadPublicAttachments(admin: ReturnType<typeof createAdminClient>, ticketIds: string[]) {
  if (ticketIds.length === 0) return [];
  const { data } = await admin
    .from('file_attachments')
    .select('id, target_id, storage_path, original_filename, mime_type, size_bytes, created_at')
    .eq('module', 'ticket')
    .eq('target_table', 'tickets')
    .in('target_id', ticketIds)
    .order('created_at', { ascending: true });

  return Promise.all((data ?? []).map(async ({ storage_path, ...attachment }) => {
    const signed = await createSignedUrl(admin, storage_path, 600);
    return { ...attachment, signed_url: 'url' in signed ? signed.url : null };
  }));
}

publicTicketsRoute.get('/form-data', async (c) => {
  const reqId = c.get('requestId');
  const enabled = formEnabled(c.env);
  if (!enabled) return c.json(ok(reqId, { enabled: false, categories: [], priorities: PRIORITIES, privacy: TICKET_PRIVACY_NOTICE }));

  const admin = createAdminClient(c.env);
  const { data, error } = await admin
    .from('ticket_categories')
    .select('id, name, response_sla_hours, resolution_sla_hours, sla_hours')
    .eq('status', 'active')
    .order('name');
  if (error) return dbFailJson(c, 'PUBLIC_TICKET_FORM_LOAD_FAILED', error);
  return c.json(ok(reqId, { enabled: true, categories: data ?? [], priorities: PRIORITIES, privacy: TICKET_PRIVACY_NOTICE }));
});

publicTicketsRoute.post(
  '/',
  edgeRateLimit({ keyFn: (c) => `public_ticket_create:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 3, keyFn: (c) => `public_ticket_create_hour:${clientIp(c)}` }),
  rateLimit({ windowMs: 86_400_000, max: 8, keyFn: (c) => `public_ticket_create_day:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 60, keyFn: () => 'public_ticket_create_global_hour' }),
  rateLimit({ windowMs: 86_400_000, max: 300, keyFn: () => 'public_ticket_create_global_day' }),
  zValidator('json', publicSubmitTicketSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    if (!formEnabled(c.env)) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_FORM_DISABLED', 'ขณะนี้ปิดรับการแจ้งซ่อมจากหน้าสาธารณะ กรุณาติดต่อส่วนงาน IT โดยตรง'), 403);
    }
    const body = c.req.valid('json');

    const turnstile = await verifyPublicTicketTurnstile(c.env, body.turnstileToken, clientIp(c));
    if (!turnstile.ok) {
      console.warn(JSON.stringify({
        msg: 'public_ticket_turnstile_rejected',
        requestId: reqId,
        reason: turnstile.reason,
      }));
      return c.json(fail(reqId, 'TURNSTILE_VERIFICATION_FAILED', 'ยืนยันความปลอดภัยไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 403);
    }

    // Honeypot: a real visitor never sees or fills this hidden field. Report a fake success
    // without touching the database, so scripted bots get no signal that they were caught.
    if (body.website) {
      const fakeId = crypto.randomUUID();
      return c.json(ok(reqId, { id: fakeId, ticketNo: fakeId, trackingToken: generateTrackingCode() }), 201);
    }

    const admin = createAdminClient(c.env);
    const { data: category } = await admin.from('ticket_categories').select('*').eq('id', body.categoryId).eq('status', 'active').maybeSingle();
    if (!category) return c.json(fail(reqId, 'TICKET_CATEGORY_INVALID', 'กรุณาเลือกประเภทปัญหาที่ใช้งานอยู่'), 400);

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

    const trackingToken = generateTrackingCode();
    const trackingTokenHash = await hashTrackingToken(trackingToken);

    const { data: ticket, error } = await admin
      .from('tickets')
      .insert({
        title: body.title,
        requester_position_snapshot: body.requesterPosition ?? null,
        requester_phone: body.requesterPhone ?? null,
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
        is_security: category.is_security_default ?? false,
        status: 'ใหม่',
        source_channel: 'guest',
        guest_name: body.guestName,
        guest_department: body.guestDepartment ?? null,
        public_tracking_token_hash: trackingTokenHash,
        ...ticketConsentEvidence('PUBLIC_TICKET_WEB', now),
      })
      .select()
      .single();
    if (error || !ticket) return dbFailJson(c, 'TICKET_CREATE_FAILED', error, 'สร้าง Ticket ไม่สำเร็จ');

    await admin.from('ticket_worklogs').insert({
      ticket_id: ticket.id, action: 'เปิด Ticket', status_to: 'ใหม่', detail: 'สร้างผ่านหน้าสาธารณะ (ไม่ต้องเข้าสู่ระบบ)',
      is_public: true, actor_label: `ผู้แจ้งผ่านหน้าสาธารณะ: ${body.guestName}`,
    });
    await writeAuditLog(c.env, {
      actorEmail: `GUEST:${clientIp(c)}`, action: 'CREATE', module: 'ticket', targetTable: 'tickets',
      targetId: ticket.id, detail: { title: body.title, categoryId: body.categoryId, channel: 'guest', guestName: body.guestName }, requestId: reqId,
    });
    await notifyTicketTeam(c.env, `Ticket ใหม่จากหน้าสาธารณะ: ${ticket.title} (${ticket.ticket_no})`, buildTicketFlexMessage({
      eyebrow: 'มีรายการแจ้งซ่อมใหม่',
      title: ticket.title,
      ticketNo: ticket.ticket_no,
      status: ticket.status,
      priority: ticket.priority,
      requesterName: ticket.guest_name,
      fields: [
        { label: 'แผนก', value: ticket.guest_department },
        { label: 'ตำแหน่ง', value: ticket.requester_position_snapshot },
        { label: 'เบอร์ติดต่อ', value: ticket.requester_phone },
        { label: 'หมวดหมู่', value: category.name },
        { label: 'สถานที่', value: ticket.location },
        { label: 'อุปกรณ์', value: ticket.asset_name_snapshot },
        { label: 'โมดูล ERP', value: ticket.erp_module },
        { label: 'เกิดเหตุเมื่อ', value: formatThaiDateTime(ticket.incident_at) },
        { label: 'ต้องตอบรับภายใน', value: formatThaiDateTime(ticket.response_due_at) },
        { label: 'กำหนดเสร็จ', value: formatThaiDateTime(ticket.due_at) },
      ],
      detail: ticket.description,
      detailLabel: 'อาการที่แจ้ง',
      footnote: `แจ้งผ่านหน้าสาธารณะเมื่อ ${formatThaiDateTime(ticket.created_at) ?? formatThaiDateTime(now)}`,
      url: appUrl(c.env, `/tickets/${ticket.id}`),
      buttonLabel: 'เปิดรับเรื่อง',
    }));

    return c.json(ok(reqId, { id: ticket.id, ticketNo: ticket.ticket_no, trackingToken }), 201);
  },
);

publicTicketsRoute.post(
  '/:id/attachments',
  edgeRateLimit({ keyFn: (c) => `public_ticket_attachment:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 20, keyFn: (c) => `public_ticket_attachment:${clientIp(c)}` }),
  async (c) => {
    const reqId = c.get('requestId');
    const tokenResult = publicTicketStatusQuerySchema.safeParse({ token: c.req.header('x-tracking-token') });
    if (!tokenResult.success) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือรหัสติดตามไม่ถูกต้อง'), 404);
    }

    const contentLength = Number(c.req.header('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES + 1024 * 1024) {
      return c.json(fail(reqId, 'FILE_TOO_LARGE', 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB'), 413);
    }

    const ticketId = c.req.param('id');
    const admin = createAdminClient(c.env);
    const tokenHash = await hashTrackingToken(tokenResult.data.token);
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, ticket_no, guest_name')
      .eq('id', ticketId)
      .eq('source_channel', 'guest')
      .eq('public_tracking_token_hash', tokenHash)
      .maybeSingle();
    if (!ticket) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือรหัสติดตามไม่ถูกต้อง'), 404);
    }

    const { count, error: countError } = await admin
      .from('file_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('module', 'ticket')
      .eq('target_table', 'tickets')
      .eq('target_id', ticket.id);
    if (countError) return dbFailJson(c, 'FILE_ATTACHMENT_COUNT_FAILED', countError, 'ตรวจสอบจำนวนไฟล์ไม่สำเร็จ');
    if ((count ?? 0) >= MAX_PUBLIC_TICKET_ATTACHMENTS) {
      return c.json(fail(reqId, 'FILE_LIMIT_REACHED', `แนบได้สูงสุด ${MAX_PUBLIC_TICKET_ATTACHMENTS} ไฟล์ต่อ Ticket`), 400);
    }

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json(fail(reqId, 'VALIDATION_ERROR', 'กรุณาเลือกไฟล์ที่ต้องการแนบ'), 400);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return c.json(fail(reqId, 'FILE_TOO_LARGE', 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB'), 413);
    }
    if (!(PUBLIC_TICKET_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
      return c.json(fail(reqId, 'FILE_TYPE_NOT_ALLOWED', 'รองรับเฉพาะ JPG, PNG, GIF, WebP และ PDF'), 400);
    }

    const signature = await verifyFileSignature(file, file.type);
    if (!signature.ok || !signature.resolvedMime) {
      await writeAuditLog(c.env, {
        actorEmail: `GUEST:${clientIp(c)}`,
        action: 'UPLOAD_REJECTED',
        module: 'file',
        targetTable: 'file_attachments',
        targetId: ticket.id,
        detail: { filename: file.name, declaredMimeType: file.type, sizeBytes: file.size, reason: signature.reason },
        result: 'denied',
        requestId: reqId,
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
        uploader_label: `ผู้แจ้งผ่านหน้าสาธารณะ: ${ticket.guest_name ?? '-'}`,
      })
      .select('id, original_filename, mime_type, size_bytes, created_at')
      .single();
    if (metadataError || !attachment) {
      await deleteFile(admin, uploaded.path);
      return c.json(fail(reqId, 'FILE_METADATA_SAVE_FAILED', 'บันทึกข้อมูลไฟล์ไม่สำเร็จ'), 400);
    }

    await writeAuditLog(c.env, {
      actorEmail: `GUEST:${clientIp(c)}`,
      action: 'UPLOAD',
      module: 'file',
      targetTable: 'file_attachments',
      targetId: attachment.id,
      detail: { ticketId: ticket.id, originalFilename: file.name, sizeBytes: file.size, channel: 'guest' },
      requestId: reqId,
    });
    const signed = await createSignedUrl(admin, uploaded.path, 600);
    return c.json(ok(reqId, { ...attachment, signed_url: 'url' in signed ? signed.url : null }), 201);
  },
);

publicTicketsRoute.post(
  '/:id/signoff',
  edgeRateLimit({ keyFn: (c) => `public_ticket_signature:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 8, keyFn: (c) => `public_ticket_signature:${clientIp(c)}` }),
  async (c) => {
    const reqId = c.get('requestId');
    const tokenResult = publicTicketStatusQuerySchema.safeParse({ token: c.req.header('x-tracking-token') });
    if (!tokenResult.success) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือรหัสติดตามไม่ถูกต้อง'), 404);
    }
    const admin = createAdminClient(c.env);
    const tokenHash = await hashTrackingToken(tokenResult.data.token);
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, ticket_no, title, status, priority, guest_name, guest_department, assignee_name_snapshot, requester_signature_storage_path')
      .eq('id', c.req.param('id'))
      .eq('source_channel', 'guest')
      .eq('public_tracking_token_hash', tokenHash)
      .maybeSingle();
    if (!ticket) return c.json(fail(reqId, 'PUBLIC_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือรหัสติดตามไม่ถูกต้อง'), 404);
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
      return c.json(fail(reqId, 'PUBLIC_TICKET_RATING_INVALID', 'ข้อมูลแบบประเมินไม่ถูกต้อง กรุณาให้คะแนนใหม่'), 400);
    }
    const evaluation = submitTicketFeedbackSchema.safeParse({
      ratings: ratingsPayload,
      feedback: typeof body.feedback === 'string' ? body.feedback : undefined,
    });
    if (!evaluation.success) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_RATING_INVALID', evaluation.error.issues[0]?.message ?? 'กรุณาให้คะแนนให้ครบทุกหัวข้อ'), 400);
    }
    const { data: criteria, error: criteriaError } = await admin
      .from('ticket_rating_criteria')
      .select('key, label')
      .eq('status', 'active')
      .order('sort_order')
      .order('created_at');
    if (criteriaError || !criteria?.length) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_RATING_CRITERIA_UNAVAILABLE', 'ไม่พบหัวข้อประเมินที่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ'), 409);
    }
    if (!ratingsMatchCriteria(evaluation.data.ratings, criteria.map((criterion) => String(criterion.key)))) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_RATING_CRITERIA_CHANGED', 'หัวข้อประเมินมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่'), 409);
    }
    const rating = calculateTicketOverallRating(evaluation.data.ratings);
    const ratingSnapshot = criteria.map((criterion) => ({
      key: String(criterion.key), label: String(criterion.label), score: evaluation.data.ratings[String(criterion.key)],
    }));
    const saved = await saveRequesterSignature(admin, {
      ticketId: ticket.id,
      previousPath: ticket.requester_signature_storage_path,
      file,
      uploadedBy: null,
    });
    if (!saved.ok) return c.json(fail(reqId, saved.code, saved.message), 400);

    const { error: closeError } = await admin.from('tickets').update({
      status: 'ปิดงาน', closed_at: saved.uploadedAt, rating,
      rating_details: evaluation.data.ratings, rating_criteria_snapshot: ratingSnapshot,
      feedback: evaluation.data.feedback ?? null, feedback_at: saved.uploadedAt,
    }).eq('id', ticket.id).eq('status', 'เสร็จสิ้น');
    if (closeError) return dbFailJson(c, 'TICKET_REQUESTER_SIGNOFF_FAILED', closeError, 'บันทึกการตรวจรับงานไม่สำเร็จ');
    await admin.from('ticket_worklogs').insert({
      ticket_id: ticket.id, action: 'ผู้แจ้งประเมิน ตรวจรับ และลงนาม', detail: `ผู้แจ้งประเมิน ${rating}/5 คะแนน ยืนยันผลการแก้ไข และลงลายเซ็นในส่วนที่ 5`,
      status_from: 'เสร็จสิ้น', status_to: 'ปิดงาน', is_public: true,
      actor_label: `ผู้แจ้งผ่านหน้าสาธารณะ: ${ticket.guest_name ?? '-'}`,
    });

    await writeAuditLog(c.env, {
      actorEmail: `GUEST:${clientIp(c)}`, action: 'REQUESTER_SIGNOFF', module: 'ticket', targetTable: 'tickets',
      targetId: ticket.id, detail: { channel: 'guest', signer: ticket.guest_name, sizeBytes: file.size, status: 'ปิดงาน', rating, ratings: evaluation.data.ratings }, requestId: reqId,
    });
    const teamMessage = `ผู้แจ้งประเมิน ตรวจรับ และลงนามปิด ${ticket.ticket_no}: ${ticket.title}`;
    await notifyTicketTeam(c.env, teamMessage, buildTicketFlexMessage({
      eyebrow: 'ผู้แจ้งตรวจรับและปิดงานแล้ว',
      title: ticket.title,
      ticketNo: ticket.ticket_no,
      status: 'ปิดงาน',
      previousStatus: 'เสร็จสิ้น',
      priority: ticket.priority,
      requesterName: ticket.guest_name,
      rating,
      fields: [
        { label: 'แผนก', value: ticket.guest_department },
        { label: 'ผู้รับผิดชอบ', value: ticket.assignee_name_snapshot },
        ...ratingSnapshot.map((criterion) => ({ label: criterion.label, value: `${criterion.score}/5` })),
      ],
      detail: evaluation.data.feedback ?? null,
      detailLabel: 'ความเห็นจากผู้แจ้ง',
      footnote: `ตรวจรับเมื่อ ${formatThaiDateTime(saved.uploadedAt)}`,
      url: appUrl(c.env, `/tickets/${ticket.id}`),
      buttonLabel: 'ดูใบงานที่ปิดแล้ว',
    }));
    return c.json(ok(reqId, { signatureUrl: saved.signatureUrl, uploadedAt: saved.uploadedAt, status: 'ปิดงาน', rating }), 201);
  },
);

publicTicketsRoute.post(
  '/lookup',
  edgeRateLimit({ keyFn: (c) => `public_ticket_identity_lookup:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 10, keyFn: (c) => `public_ticket_identity_lookup:${clientIp(c)}` }),
  rateLimit({ windowMs: 86_400_000, max: 40, keyFn: (c) => `public_ticket_identity_lookup_day:${clientIp(c)}` }),
  async (c) => {
    // ชื่อและเบอร์โทรเป็นข้อมูลที่ผู้อื่นทราบหรือคาดเดาได้ จึงห้ามใช้เป็น authentication
    // endpoint เดิมตอบ 410 อย่างชัดเจนเพื่อให้ client รุ่นเก่าไม่ retry/ตีความเป็นผลค้นหาว่าง
    return c.json(
      fail(c.get('requestId'), 'TRACKING_TOKEN_REQUIRED', 'กรุณาใช้เลข Ticket และรหัสติดตาม หรือเข้าสู่ระบบด้วย LINE'),
      410,
    );
  },
);

publicTicketsRoute.get(
  '/:id',
  edgeRateLimit({ keyFn: (c) => `public_ticket_track:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 30, keyFn: (c) => `public_ticket_track:${clientIp(c)}` }),
  async (c) => {
    const reqId = c.get('requestId');
    const tokenResult = publicTicketStatusQuerySchema.safeParse({ token: c.req.header('x-tracking-token') });
    if (!tokenResult.success) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือรหัสติดตามไม่ถูกต้อง'), 404);
    }
    const { token } = tokenResult.data;
    const tokenHash = await hashTrackingToken(token);
    const admin = createAdminClient(c.env);

    let ticketQuery = admin
      .from('tickets')
      // ข้อมูลผู้แจ้งเป็นสิ่งที่เจ้าของใบกรอกเอง จึงส่งคืนให้เจ้าของรหัสติดตามตรวจทานได้
      .select('id, ticket_no, title, description, status, priority, resolution, created_at, resolved_at, closed_at, guest_name, guest_department, requester_position_snapshot, requester_phone, incident_at, erp_module, location, asset_name_snapshot, rating, rating_details, rating_criteria_snapshot, feedback, feedback_at, requester_signature_storage_path, requester_signature_uploaded_at, category:ticket_categories(name)')
      .eq('source_channel', 'guest')
      .eq('public_tracking_token_hash', tokenHash);
    const ticketRef = c.req.param('id')!;
    ticketQuery = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketRef)
      ? ticketQuery.eq('id', ticketRef)
      : ticketQuery.eq('ticket_no', ticketRef);
    const { data: ticket } = await ticketQuery.maybeSingle();
    if (!ticket) return c.json(fail(reqId, 'PUBLIC_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือรหัสติดตามไม่ถูกต้อง'), 404);

    const [{ data: worklogs }, { data: ratingCriteria }] = await Promise.all([
      // actor_id/actor เป็นตัวบอกว่าใครพูด: ไม่มี actor_id คือข้อความของผู้แจ้งเอง (guest ไม่มีบัญชี)
      // ส่วนที่มี actor_id คือทีม IT — หน้าเว็บใช้ค่านี้จัดข้างซ้าย/ขวาของบทสนทนา
      admin.from('ticket_worklogs')
        .select('id, entry_type, action, detail, status_from, status_to, created_at, actor_id, actor_label, actor:profiles!ticket_worklogs_actor_id_fkey(full_name)')
        .eq('ticket_id', ticket.id).eq('is_public', true).order('created_at', { ascending: true }),
      admin.from('ticket_rating_criteria').select('id, key, label, description, sort_order, status')
        .eq('status', 'active').order('sort_order').order('created_at'),
    ]);

    const attachments = await loadPublicAttachments(admin, [ticket.id]);
    let requesterSignatureUrl: string | null = null;
    if (ticket.requester_signature_storage_path) {
      const { data } = await admin.storage.from('ticket-signatures').createSignedUrl(String(ticket.requester_signature_storage_path), 3600);
      requesterSignatureUrl = data?.signedUrl ?? null;
    }

    return c.json(ok(reqId, { ticket: { ...ticket, requester_signature_url: requesterSignatureUrl }, ratingCriteria: ratingCriteria ?? [], worklogs: worklogs ?? [], attachments }));
  },
);

/**
 * ข้อความจากผู้แจ้งแบบ guest ถึงช่างที่ดำเนินการ — เก็บเป็น worklog สาธารณะใบเดียวกับที่ทีม IT
 * เห็นในหน้า Ticket จึงไม่มีกล่องข้อความแยกให้ตกหล่น รหัสติดตามคือสิ่งเดียวที่ยืนยันตัวผู้แจ้ง
 * (เหมือน GET /:id) และ rate limit กันไม่ให้ใช้เป็นช่องทางยิงข้อความ
 */
publicTicketsRoute.post(
  '/:id/conversation',
  edgeRateLimit({ keyFn: (c) => `public_ticket_message:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 30, keyFn: (c) => `public_ticket_message:${clientIp(c)}` }),
  zValidator('json', publicTicketMessageSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const tokenResult = publicTicketStatusQuerySchema.safeParse({ token: c.req.header('x-tracking-token') });
    if (!tokenResult.success) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือรหัสติดตามไม่ถูกต้อง'), 404);
    }

    const admin = createAdminClient(c.env);
    const tokenHash = await hashTrackingToken(tokenResult.data.token);
    const ticketRef = c.req.param('id')!;
    let ticketQuery = admin
      .from('tickets')
      .select('id, ticket_no, title, status, priority, guest_name, guest_department, assignee_id, assignee_name_snapshot, due_at')
      .eq('source_channel', 'guest')
      .eq('public_tracking_token_hash', tokenHash);
    ticketQuery = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketRef)
      ? ticketQuery.eq('id', ticketRef)
      : ticketQuery.eq('ticket_no', ticketRef);
    const { data: ticket } = await ticketQuery.maybeSingle();
    if (!ticket) return c.json(fail(reqId, 'PUBLIC_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือรหัสติดตามไม่ถูกต้อง'), 404);

    if (PUBLIC_TICKET_CONVERSATION_LOCKED_STATUSES.includes(String(ticket.status))) {
      return c.json(fail(reqId, 'PUBLIC_TICKET_CONVERSATION_LOCKED', 'Ticket นี้ปิดแล้ว หากยังพบปัญหากรุณาแจ้งเรื่องใหม่'), 409);
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
        actor_label: `ผู้แจ้งผ่านหน้าสาธารณะ: ${ticket.guest_name ?? '-'}`,
      })
      .select('id, entry_type, action, detail, status_from, status_to, created_at, actor_id, actor_label')
      .single();
    if (error || !worklog) return dbFailJson(c, 'PUBLIC_TICKET_MESSAGE_FAILED', error, 'ส่งข้อความไม่สำเร็จ');

    await writeAuditLog(c.env, {
      actorEmail: `GUEST:${clientIp(c)}`, action: 'COMMENT', module: 'ticket',
      targetTable: 'ticket_worklogs', targetId: String(worklog.id),
      detail: { ticketId: ticket.id, channel: 'guest' }, requestId: reqId,
    });

    if (ticket.assignee_id) {
      await sendNotification(c.env, {
        recipientId: String(ticket.assignee_id),
        type: 'ticket_comment',
        title: `มีข้อความใหม่ใน ${ticket.ticket_no}`,
        body: message.slice(0, 200),
        link: `/tickets/${ticket.id}`,
      });
    }
    await notifyTicketTeam(c.env, `ข้อความใหม่จากผู้แจ้ง (${ticket.ticket_no}): ${message}`, buildTicketFlexMessage({
      eyebrow: 'ผู้แจ้งส่งข้อความใหม่',
      title: ticket.title,
      ticketNo: ticket.ticket_no,
      status: ticket.status,
      priority: ticket.priority,
      requesterName: ticket.guest_name,
      fields: [
        { label: 'แผนก', value: ticket.guest_department },
        { label: 'ผู้รับผิดชอบ', value: ticket.assignee_name_snapshot ?? 'ยังไม่มอบหมาย' },
        { label: 'กำหนดเสร็จ', value: formatThaiDateTime(ticket.due_at) },
      ],
      detail: message,
      detailLabel: 'ข้อความจากผู้แจ้ง',
      footnote: `ส่งเมื่อ ${formatThaiDateTime(worklog.created_at)}`,
      url: appUrl(c.env, `/tickets/${ticket.id}`),
      buttonLabel: 'ตอบกลับผู้แจ้ง',
    }));

    return c.json(ok(reqId, worklog), 201);
  },
);
