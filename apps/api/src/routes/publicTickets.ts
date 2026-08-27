import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { notifyTicketTeam } from '../lib/lineMessaging';
import { createAdminClient } from '../lib/supabase';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { writeAuditLog } from '../services/auditService';
import { createSignedUrl, deleteFile, uploadPublicTicketFile } from '../services/storageService';
import { addTicketBusinessHours, parseTicketBusinessCalendar } from '../services/ticketSlaService';
import { saveRequesterSignature } from '../services/ticketSignatureService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { verifyFileSignature } from '../utils/fileSignature';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { publicSubmitTicketSchema, publicTicketStatusQuerySchema } from '../validators/publicTickets';
import { MAX_FILE_SIZE_BYTES } from '../validators/files';

/**
 * Public (no-login) ticket report page — port of legacy-gas/PublicTicket.html's "แจ้งซ่อม" +
 * "ติดตามสถานะ" tabs. Anyone can submit with just a typed name, no LINE and no Supabase account
 * (see supabase/migrations/20260831100000_public_guest_tickets.sql). Every route here runs on the
 * service-role client with its own validation/rate-limiting instead of RLS, the same pattern
 * routes/line.ts established — there is no Supabase JWT or LINE session to authorize against.
 */
export const publicTicketsRoute = new Hono<AppEnv>();

const PRIORITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;
const PRIVACY_NOTICE = {
  version: '2026-08-31',
  summary: 'ระบบใช้ข้อมูลผู้แจ้งเพื่อรับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม และแจ้งสถานะ Ticket เท่านั้น',
  dpoContact: 'DPO / ส่วนงาน IT',
};

const TRACKING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PUBLIC_TICKET_ATTACHMENTS = 5;
const PUBLIC_TICKET_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'] as const;

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
  if (!enabled) return c.json(ok(reqId, { enabled: false, categories: [], priorities: PRIORITIES, privacy: PRIVACY_NOTICE }));

  const admin = createAdminClient(c.env);
  const { data, error } = await admin
    .from('ticket_categories')
    .select('id, name, response_sla_hours, resolution_sla_hours, sla_hours')
    .eq('status', 'active')
    .order('name');
  if (error) return dbFailJson(c, 'PUBLIC_TICKET_FORM_LOAD_FAILED', error);
  return c.json(ok(reqId, { enabled: true, categories: data ?? [], priorities: PRIORITIES, privacy: PRIVACY_NOTICE }));
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
    await notifyTicketTeam(c.env, `Ticket ใหม่จากหน้าสาธารณะ: ${ticket.title} (${ticket.ticket_no})`);

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
      .select('id, ticket_no, title, status, guest_name, requester_signature_storage_path')
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
    const saved = await saveRequesterSignature(admin, {
      ticketId: ticket.id,
      previousPath: ticket.requester_signature_storage_path,
      file,
      uploadedBy: null,
    });
    if (!saved.ok) return c.json(fail(reqId, saved.code, saved.message), 400);

    const { error: closeError } = await admin.from('tickets').update({ status: 'ปิดงาน', closed_at: saved.uploadedAt }).eq('id', ticket.id).eq('status', 'เสร็จสิ้น');
    if (closeError) return dbFailJson(c, 'TICKET_REQUESTER_SIGNOFF_FAILED', closeError, 'บันทึกการตรวจรับงานไม่สำเร็จ');
    await admin.from('ticket_worklogs').insert({
      ticket_id: ticket.id, action: 'ผู้แจ้งตรวจรับและลงนาม', detail: 'ผู้แจ้งยืนยันผลการแก้ไขในส่วนที่ 5',
      status_from: 'เสร็จสิ้น', status_to: 'ปิดงาน', is_public: true,
      actor_label: `ผู้แจ้งผ่านหน้าสาธารณะ: ${ticket.guest_name ?? '-'}`,
    });

    await writeAuditLog(c.env, {
      actorEmail: `GUEST:${clientIp(c)}`, action: 'REQUESTER_SIGNOFF', module: 'ticket', targetTable: 'tickets',
      targetId: ticket.id, detail: { channel: 'guest', signer: ticket.guest_name, sizeBytes: file.size, status: 'ปิดงาน' }, requestId: reqId,
    });
    await notifyTicketTeam(c.env, `ผู้แจ้งตรวจรับและลงนามปิด ${ticket.ticket_no}: ${ticket.title}`);
    return c.json(ok(reqId, { signatureUrl: saved.signatureUrl, uploadedAt: saved.uploadedAt, status: 'ปิดงาน' }), 201);
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
      .select('id, ticket_no, title, description, status, priority, resolution, created_at, resolved_at, closed_at, requester_signature_storage_path, requester_signature_uploaded_at, category:ticket_categories(name)')
      .eq('source_channel', 'guest')
      .eq('public_tracking_token_hash', tokenHash);
    const ticketRef = c.req.param('id')!;
    ticketQuery = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketRef)
      ? ticketQuery.eq('id', ticketRef)
      : ticketQuery.eq('ticket_no', ticketRef);
    const { data: ticket } = await ticketQuery.maybeSingle();
    if (!ticket) return c.json(fail(reqId, 'PUBLIC_TICKET_NOT_FOUND', 'ไม่พบ Ticket นี้ หรือรหัสติดตามไม่ถูกต้อง'), 404);

    const { data: worklogs } = await admin
      .from('ticket_worklogs')
      .select('action, detail, status_from, status_to, created_at')
      .eq('ticket_id', ticket.id).eq('is_public', true).order('created_at', { ascending: true });

    const attachments = await loadPublicAttachments(admin, [ticket.id]);
    let requesterSignatureUrl: string | null = null;
    if (ticket.requester_signature_storage_path) {
      const { data } = await admin.storage.from('ticket-signatures').createSignedUrl(String(ticket.requester_signature_storage_path), 3600);
      requesterSignatureUrl = data?.signedUrl ?? null;
    }

    return c.json(ok(reqId, { ticket: { ...ticket, requester_signature_url: requesterSignatureUrl }, worklogs: worklogs ?? [], attachments }));
  },
);
