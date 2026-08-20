import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  createTicketRatingCriterionSchema,
  listTicketRatingCriteriaQuerySchema,
  updateTicketRatingCriterionSchema,
} from '../validators/ticketRatingCriteria';

export const ticketRatingCriteriaRoute = new Hono<AppEnv>();
ticketRatingCriteriaRoute.use('*', requireAuth);

ticketRatingCriteriaRoute.get(
  '/',
  zValidator('query', listTicketRatingCriteriaQuerySchema, zodValidationHook),
  async (c) => {
    const requestId = c.get('requestId');
    const { includeInactive } = c.req.valid('query');
    let query = c.get('supabase')
      .from('ticket_rating_criteria')
      .select('*')
      .order('sort_order')
      .order('created_at');
    if (includeInactive !== 'true') query = query.eq('status', 'active');
    const { data, error } = await query;
    if (error) return dbFailJson(c, 'TICKET_RATING_CRITERIA_LIST_FAILED', error);
    return c.json(ok(requestId, data ?? []));
  },
);

ticketRatingCriteriaRoute.post(
  '/',
  requirePermission('setting.manage'),
  zValidator('json', createTicketRatingCriterionSchema, zodValidationHook),
  async (c) => {
    const requestId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');
    const supabase = c.get('supabase');
    let sortOrder = body.sortOrder;
    if (sortOrder === undefined) {
      const { data: last } = await supabase
        .from('ticket_rating_criteria')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      sortOrder = Math.min(Number(last?.sort_order ?? 0) + 10, 9999);
    }
    const key = `criterion_${crypto.randomUUID().replaceAll('-', '')}`;
    const { data, error } = await supabase.from('ticket_rating_criteria').insert({
      key,
      label: body.label,
      description: body.description || null,
      sort_order: sortOrder,
      created_by: actorId,
      updated_by: actorId,
    }).select().single();
    if (error) return dbFailJson(c, 'TICKET_RATING_CRITERION_CREATE_FAILED', error);
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'ticket_rating',
      targetTable: 'ticket_rating_criteria',
      targetId: data.id,
      detail: body,
      requestId,
    });
    return c.json(ok(requestId, data), 201);
  },
);

ticketRatingCriteriaRoute.patch(
  '/:id',
  requirePermission('setting.manage'),
  zValidator('json', updateTicketRatingCriterionSchema, zodValidationHook),
  async (c) => {
    const requestId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const supabase = c.get('supabase');
    const before = await loadAuditSnapshot(supabase, 'ticket_rating_criteria', id);
    if (!before) return c.json(fail(requestId, 'TICKET_RATING_CRITERION_NOT_FOUND', 'ไม่พบหัวข้อประเมินที่ระบุ'), 404);

    if (body.status === 'inactive' && before.status === 'active') {
      const { count, error: countError } = await supabase
        .from('ticket_rating_criteria')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active');
      if (countError) return dbFailJson(c, 'TICKET_RATING_CRITERIA_COUNT_FAILED', countError);
      if ((count ?? 0) <= 1) {
        return c.json(fail(requestId, 'LAST_TICKET_RATING_CRITERION', 'ต้องเปิดใช้งานหัวข้อประเมินอย่างน้อย 1 หัวข้อ'), 409);
      }
    }

    const patch: Record<string, unknown> = { updated_by: actorId, updated_at: new Date().toISOString() };
    if (body.label !== undefined) patch.label = body.label;
    if (body.description !== undefined) patch.description = body.description || null;
    if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
    if (body.status !== undefined) patch.status = body.status;
    const { data, error } = await supabase.from('ticket_rating_criteria').update(patch).eq('id', id).select().single();
    if (error) return dbFailJson(c, 'TICKET_RATING_CRITERION_UPDATE_FAILED', error);
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'ticket_rating',
      targetTable: 'ticket_rating_criteria',
      targetId: id,
      detail: body,
      before,
      after: data,
      requestId,
    });
    return c.json(ok(requestId, data));
  },
);

