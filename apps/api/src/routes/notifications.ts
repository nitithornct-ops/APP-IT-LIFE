import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { listNotificationsQuerySchema } from '../validators/notifications';

export const notificationsRoute = new Hono<AppEnv>();

notificationsRoute.use('*', requireAuth);

/** RLS (recipient_id = auth.uid()) จำกัดให้เห็นเฉพาะการแจ้งเตือนของตนเองอยู่แล้ว ไม่ต้องเช็ค permission เพิ่ม */
notificationsRoute.get('/', zValidator('query', listNotificationsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, unreadOnly } = c.req.valid('query');

  let query = supabase
    .from('notifications')
    .select('id, type, title, body, link, is_read, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(...paginationRange(page, pageSize));

  if (unreadOnly) query = query.eq('is_read', false);

  const { data, count, error } = await query;

  if (error) {
    return c.json(fail(reqId, 'NOTIFICATIONS_LIST_FAILED', 'ดึงรายการแจ้งเตือนไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});

notificationsRoute.get('/unread-count', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  if (error) {
    return c.json(fail(reqId, 'NOTIFICATIONS_COUNT_FAILED', 'นับจำนวนแจ้งเตือนที่ยังไม่อ่านไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, { count: count ?? 0 }));
});

notificationsRoute.patch('/read-all', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('is_read', false);

  if (error) {
    return c.json(fail(reqId, 'NOTIFICATIONS_READ_ALL_FAILED', 'ทำเครื่องหมายอ่านทั้งหมดไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, { updated: true }));
});

notificationsRoute.patch('/:id/read', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id');

  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'NOTIFICATION_READ_FAILED', 'ไม่พบการแจ้งเตือนนี้ หรือทำเครื่องหมายอ่านไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, data));
});
