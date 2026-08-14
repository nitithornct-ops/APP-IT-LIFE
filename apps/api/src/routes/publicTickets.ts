import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { randomToken } from '../lib/lineAuth';
import { notifyTicketTeam } from '../lib/lineMessaging';
import { createAdminClient } from '../lib/supabase';
import { clientIp, edgeRateLimit, rateLimit } from '../middleware/rateLimit';
import { writeAuditLog } from '../services/auditService';
import { addTicketBusinessHours, parseTicketBusinessCalendar } from '../services/ticketSlaService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { publicSubmitTicketSchema, publicTicketStatusQuerySchema } from '../validators/publicTickets';

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

async function hashTrackingToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function formEnabled(env: AppEnv['Bindings']): boolean {
  return env.PUBLIC_TICKET_FORM_ENABLED !== 'false';
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
      return c.json(ok(reqId, { id: fakeId, ticketNo: fakeId, trackingToken: randomToken() }), 201);
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

    const trackingToken = randomToken();
    const trackingTokenHash = await hashTrackingToken(trackingToken);

    const { data: ticket, error } = await admin
      .from('tickets')
      .insert({
        title: body.title,
        requester_phone: body.requesterPhone ?? null,
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

publicTicketsRoute.get(
  '/:id',
  edgeRateLimit({ keyFn: (c) => `public_ticket_track:${clientIp(c)}` }),
  rateLimit({ windowMs: 3600_000, max: 30, keyFn: (c) => `public_ticket_track:${clientIp(c)}` }),
  zValidator('query', publicTicketStatusQuerySchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const { token } = c.req.valid('query');
    const tokenHash = await hashTrackingToken(token);
    const admin = createAdminClient(c.env);

    let ticketQuery = admin
      .from('tickets')
      .select('id, ticket_no, title, description, status, priority, resolution, created_at, resolved_at, closed_at, category:ticket_categories(name)')
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

    return c.json(ok(reqId, { ticket, worklogs: worklogs ?? [] }));
  },
);
