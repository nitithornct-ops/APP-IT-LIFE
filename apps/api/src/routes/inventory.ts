import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  adjustInventoryStockSchema,
  createBinSchema,
  createCycleCountCampaignSchema,
  createInventoryItemSchema,
  createInventoryRequestSchema,
  createPurchaseReceiptSchema,
  createReservationSchema,
  createWarehouseSchema,
  inventoryDecisionSchema,
  listInventoryItemsQuerySchema,
  listInventoryRequestsQuerySchema,
  listPurchaseReceiptsQuerySchema,
  listReservationsQuerySchema,
  recordInventoryTransactionSchema,
  setInventoryItemStatusSchema,
  submitCycleCountSchema,
  updateInventoryItemSchema,
} from '../validators/inventory';

export const inventoryItemsRoute = new Hono<AppEnv>();
inventoryItemsRoute.use('*', requireAuth);

type RecipientRow = { user_id: string };

async function inventoryApproverIds(env: AppEnv['Bindings']): Promise<string[]> {
  const { data } = await createAdminClient(env)
    .from('user_roles')
    .select('user_id, roles!inner(key), profiles!inner(status)')
    .in('roles.key', ['super_admin', 'it_admin', 'manager', 'approver'])
    .eq('profiles.status', 'active');
  return [...new Set(((data ?? []) as RecipientRow[]).map((row) => row.user_id))];
}

async function notifyInventoryApprovers(env: AppEnv['Bindings'], input: { type: string; title: string; body?: string; link: string }) {
  for (const recipientId of await inventoryApproverIds(env)) {
    await sendNotification(env, { recipientId, type: input.type, title: input.title, body: input.body, link: input.link });
  }
}

async function checkLowStock(env: AppEnv['Bindings'], requestId: string) {
  const admin = createAdminClient(env);
  const { data, error } = await admin
    .from('inventory_items')
    .select('id, item_name, stock_qty, reorder_point, unit, low_stock_notification_enabled')
    .eq('status', 'active')
    .eq('low_stock_notification_enabled', true);
  if (error) throw error;
  const lowItems = (data ?? []).filter((item) => Number(item.stock_qty) <= Number(item.reorder_point));
  const now = new Date();
  let notified = 0;
  for (const item of lowItems) {
    const { data: alert } = await admin.from('inventory_low_stock_alerts').select('last_notified_at').eq('item_id', item.id).maybeSingle();
    const lastNotified = alert?.last_notified_at ? new Date(alert.last_notified_at).getTime() : 0;
    const shouldNotify = !lastNotified || now.getTime() - lastNotified >= 24 * 60 * 60 * 1000;
    if (shouldNotify) {
      await notifyInventoryApprovers(env, {
        type: 'inventory_low_stock',
        title: `แจ้งเตือนสต็อกต่ำ: ${item.item_name}`,
        body: `คงเหลือ ${item.stock_qty} ${item.unit} ต่ำกว่าจุดสั่งซื้อ ${item.reorder_point}`,
        link: '/inventory-items',
      });
      notified += 1;
    }
    await admin.from('inventory_low_stock_alerts').upsert({
      item_id: item.id,
      stock_qty: item.stock_qty,
      reorder_point: item.reorder_point,
      last_notified_at: shouldNotify ? now.toISOString() : alert?.last_notified_at ?? null,
      resolved_at: null,
    }, { onConflict: 'item_id' });
  }
  await writeAuditLog(env, { action: 'CHECK_LOW_STOCK', module: 'inventory', targetTable: 'inventory_low_stock_alerts', detail: { lowItems: lowItems.length, notified }, requestId });
  return { lowItems: lowItems.length, notified };
}

inventoryItemsRoute.get('/', requirePermission('inventory.view'), zValidator('query', listInventoryItemsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, lowStockOnly } = c.req.valid('query');
  let query = supabase.from('inventory_items').select('*', { count: 'exact' }).order('item_name').range(...paginationRange(page, pageSize));
  if (status) query = query.eq('status', status);
  const safeSearch = search ? cleanSearch(search) : '';
  if (safeSearch) query = query.or(`item_name.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%,barcode.ilike.%${safeSearch}%`);
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'INVENTORY_LIST_FAILED', 'ดึงรายการ Inventory ไม่สำเร็จ'), 400);

  const ids = (data ?? []).map((row) => row.id);
  const { data: reservations, error: reservationError } = ids.length
    ? await supabase.from('inventory_reservations').select('item_id, reserved_qty').eq('status', 'ACTIVE').in('item_id', ids)
    : { data: [], error: null };
  if (reservationError) return c.json(fail(reqId, 'INVENTORY_RESERVATIONS_LOAD_FAILED', 'ดึงยอดจองสต็อกไม่สำเร็จ'), 400);
  const reserved = new Map<string, number>();
  for (const row of reservations ?? []) reserved.set(row.item_id, (reserved.get(row.item_id) ?? 0) + Number(row.reserved_qty));
  let items = (data ?? []).map((row) => ({
    ...row,
    reserved_qty: reserved.get(row.id) ?? 0,
    available_qty: Number(row.stock_qty) - (reserved.get(row.id) ?? 0),
    low: Number(row.stock_qty) <= Number(row.reorder_point ?? row.min_qty),
    value: Number(row.stock_qty) * Number(row.unit_price ?? row.last_purchase_price ?? 0),
  }));
  if (lowStockOnly === 'true') items = items.filter((row) => row.low);
  return c.json(ok(reqId, toPaginatedData(items, count, page, pageSize)));
});

inventoryItemsRoute.get('/options', requirePermission('inventory.view'), async (c) => {
  const reqId = c.get('requestId');
  const supabase = c.get('supabase');
  const admin = createAdminClient(c.env);
  const [warehouses, bins, vendors] = await Promise.all([
    supabase.from('inventory_warehouses').select('id, code, name').eq('status', 'active').order('code').limit(1000),
    supabase.from('inventory_bins').select('id, warehouse_id, code, name').eq('status', 'active').order('code').limit(5000),
    admin.from('vendors').select('id, vendor_code, name, status').eq('status', 'Active').order('name').limit(2000),
  ]);
  const error = warehouses.error ?? bins.error ?? vendors.error;
  if (error) return c.json(fail(reqId, 'INVENTORY_OPTIONS_FAILED', 'ดึงข้อมูลอ้างอิง Inventory ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { warehouses: warehouses.data ?? [], bins: bins.data ?? [], vendors: vendors.data ?? [] }));
});

inventoryItemsRoute.post('/', requirePermission('inventory.manage'), zValidator('json', createInventoryItemSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const actorId = c.get('userId');
  const { data, error } = await c.get('supabase').from('inventory_items').insert({
    item_name: body.itemName, category: body.category ?? null, unit: body.unit, stock_qty: body.stockQty ?? 0,
    min_qty: body.minQty ?? 0, reorder_point: body.reorderPoint ?? body.minQty ?? 0, location: body.location ?? null,
    warehouse_id: body.warehouseId ?? null, bin_id: body.binId ?? null, barcode: body.barcode || null, vendor_id: body.vendorId ?? null,
    unit_price: body.unitPrice ?? null, reorder_qty: body.reorderQty ?? null,
    low_stock_notification_enabled: body.lowStockNotificationEnabled ?? true, valuation_method: body.valuationMethod ?? 'STANDARD',
    notes: body.notes ?? null, created_by: actorId,
  }).select().single();
  if (error) return dbFailJson(c, 'INVENTORY_ITEM_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'inventory', targetTable: 'inventory_items', targetId: data.id, detail: { itemName: body.itemName }, requestId: c.get('requestId') });
  return c.json(ok(c.get('requestId'), data), 201);
});

inventoryItemsRoute.patch('/:id', requirePermission('inventory.manage'), zValidator('json', updateInventoryItemSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const patch: Record<string, unknown> = { updated_by: c.get('userId') };
  if (body.itemName !== undefined) patch.item_name = body.itemName;
  if (body.category !== undefined) patch.category = body.category;
  if (body.unit !== undefined) patch.unit = body.unit;
  if (body.minQty !== undefined) patch.min_qty = body.minQty;
  if (body.reorderPoint !== undefined) patch.reorder_point = body.reorderPoint;
  if (body.location !== undefined) patch.location = body.location;
  if (body.warehouseId !== undefined) patch.warehouse_id = body.warehouseId;
  if (body.binId !== undefined) patch.bin_id = body.binId;
  if (body.barcode !== undefined) patch.barcode = body.barcode || null;
  if (body.vendorId !== undefined) patch.vendor_id = body.vendorId;
  if (body.unitPrice !== undefined) patch.unit_price = body.unitPrice;
  if (body.reorderQty !== undefined) patch.reorder_qty = body.reorderQty;
  if (body.lowStockNotificationEnabled !== undefined) patch.low_stock_notification_enabled = body.lowStockNotificationEnabled;
  if (body.valuationMethod !== undefined) patch.valuation_method = body.valuationMethod;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.status !== undefined) patch.status = body.status;
  const before = await loadAuditSnapshot(supabase, 'inventory_items', id);
  const { data, error } = await supabase.from('inventory_items').update(patch).eq('id', id).select().single();
  if (error) return dbFailJson(c, 'INVENTORY_ITEM_UPDATE_FAILED', error);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'inventory', targetTable: 'inventory_items', targetId: id, detail: body, requestId: c.get('requestId'), before, after: data });
  return c.json(ok(c.get('requestId'), data));
});

inventoryItemsRoute.post('/:id/status', requirePermission('inventory.manage'), zValidator('json', setInventoryItemStatusSchema, zodValidationHook), async (c) => {
  const { status } = c.req.valid('json');
  const { data, error } = await c.get('supabase').from('inventory_items').update({ status, updated_by: c.get('userId') }).eq('id', c.req.param('id')).select().single();
  if (error) return dbFailJson(c, 'INVENTORY_ITEM_STATUS_FAILED', error);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'UPDATE_STATUS', module: 'inventory', targetTable: 'inventory_items', targetId: c.req.param('id'), detail: { status }, requestId: c.get('requestId') });
  return c.json(ok(c.get('requestId'), data));
});

inventoryItemsRoute.get('/:id/transactions', requirePermission('inventory.view'), async (c) => {
  const { data, error } = await c.get('supabase').from('inventory_transactions').select('*').eq('item_id', c.req.param('id')).order('created_at', { ascending: false }).limit(200);
  if (error) return c.json(fail(c.get('requestId'), 'INVENTORY_LEDGER_FAILED', 'ดึงประวัติการเบิก-รับไม่สำเร็จ'), 400);
  return c.json(ok(c.get('requestId'), data ?? []));
});

inventoryItemsRoute.post('/:id/transactions', requirePermission('inventory.manage'), zValidator('json', recordInventoryTransactionSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).rpc('record_inventory_transaction', {
    item_id_input: c.req.param('id'), transaction_type_input: body.transactionType, qty_input: body.qty, notes_input: body.notes ?? '',
    actor_id_input: c.get('userId'), actor_email_input: c.get('userEmail'), request_id_input: c.get('requestId'),
    ticket_id_input: body.ticketId ?? null, task_id_input: body.taskId ?? null,
  });
  if (error?.message.includes('INVENTORY_ITEM_NOT_FOUND')) return c.json(fail(c.get('requestId'), 'INVENTORY_ITEM_NOT_FOUND', 'ไม่พบรายการนี้'), 404);
  if (error?.message.includes('INVENTORY_TICKET_NOT_FOUND')) return c.json(fail(c.get('requestId'), 'INVENTORY_TICKET_NOT_FOUND', 'ไม่พบ Ticket ที่ระบุ'), 404);
  if (error?.message.includes('INVENTORY_TASK_NOT_FOUND')) return c.json(fail(c.get('requestId'), 'INVENTORY_TASK_NOT_FOUND', 'ไม่พบ Task ที่ระบุ'), 404);
  if (error?.message.includes('INVENTORY_INSUFFICIENT_AVAILABLE')) return c.json(fail(c.get('requestId'), 'INVENTORY_INSUFFICIENT_AVAILABLE', 'สต็อกที่พร้อมจ่ายไม่พอหลังหักยอดจอง'), 400);
  if (error?.message.includes('INVENTORY_INSUFFICIENT_STOCK')) return c.json(fail(c.get('requestId'), 'INVENTORY_INSUFFICIENT_STOCK', 'สต็อกคงเหลือไม่พอ'), 400);
  if (error) return dbFailJson(c, 'INVENTORY_TX_FAILED', error);
  return c.json(ok(c.get('requestId'), data), 201);
});

inventoryItemsRoute.post('/:id/adjust', requirePermission('inventory.manage'), zValidator('json', adjustInventoryStockSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data: item, error: itemError } = await c.get('supabase').from('inventory_items').select('id, stock_qty').eq('id', c.req.param('id')).maybeSingle();
  if (itemError) return dbFailJson(c, 'INVENTORY_ADJUST_LOAD_FAILED', itemError);
  if (!item) return c.json(fail(c.get('requestId'), 'INVENTORY_ITEM_NOT_FOUND', 'ไม่พบรายการนี้'), 404);
  const { data, error } = await c.get('supabase').from('inventory_adjustment_requests').insert({
    item_id: item.id, current_qty: item.stock_qty, counted_qty: body.counted, requested_by: c.get('userId'), reason: body.notes ?? null,
  }).select().single();
  if (error) return dbFailJson(c, 'INVENTORY_ADJUST_REQUEST_FAILED', error);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'REQUEST_ADJUSTMENT', module: 'inventory', targetTable: 'inventory_adjustment_requests', targetId: data.id, detail: { itemId: item.id, counted: body.counted }, requestId: c.get('requestId') });
  await notifyInventoryApprovers(c.env, { type: 'inventory_adjustment_pending', title: 'มีคำขอปรับยอดสต็อกรออนุมัติ', body: `รายการ ${item.id} นับได้ ${body.counted}`, link: '/inventory-items' });
  return c.json(ok(c.get('requestId'), data), 201);
});

inventoryItemsRoute.post('/low-stock/check', requirePermission('inventory.manage'), async (c) => {
  try { return c.json(ok(c.get('requestId'), await checkLowStock(c.env, c.get('requestId')))); }
  catch (error) { return dbFailJson(c, 'INVENTORY_LOW_STOCK_CHECK_FAILED', error as never); }
});

inventoryItemsRoute.get('/requests', requirePermission('inventory.view'), zValidator('query', listInventoryRequestsQuerySchema, zodValidationHook), async (c) => {
  const { page, pageSize, status, mine } = c.req.valid('query');
  let query = c.get('supabase').from('inventory_requests').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (status) query = query.eq('status', status);
  if (mine === 'true') query = query.eq('requester_id', c.get('userId'));
  const { data, count, error } = await query;
  if (error) return c.json(fail(c.get('requestId'), 'INVENTORY_REQUESTS_LIST_FAILED', 'ดึงคำขอเบิกไม่สำเร็จ'), 400);
  return c.json(ok(c.get('requestId'), toPaginatedData(data ?? [], count, page, pageSize)));
});

inventoryItemsRoute.post('/requests', requirePermission('inventory.view'), zValidator('json', createInventoryRequestSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).rpc('create_inventory_request', {
    requester_id_input: c.get('userId'), purpose_input: body.purpose ?? '', ticket_id_input: body.ticketId ?? null, task_id_input: body.taskId ?? null,
    lines_input: body.lines, actor_email_input: c.get('userEmail'), request_id_input: c.get('requestId'),
  });
  if (error?.message.includes('INVENTORY_ITEM_NOT_FOUND')) return c.json(fail(c.get('requestId'), 'INVENTORY_ITEM_NOT_FOUND', 'ไม่พบรายการสินค้าที่เลือก'), 404);
  if (error) return dbFailJson(c, 'INVENTORY_REQUEST_CREATE_FAILED', error);
  await notifyInventoryApprovers(c.env, { type: 'inventory_request_pending', title: 'มีคำขอเบิกของใหม่รออนุมัติ', body: body.purpose, link: '/inventory-items' });
  return c.json(ok(c.get('requestId'), data), 201);
});

inventoryItemsRoute.post('/requests/:id/decision', requirePermission('inventory.approve'), zValidator('json', inventoryDecisionSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data: current } = await c.get('supabase').from('inventory_requests').select('requester_id').eq('id', c.req.param('id')).maybeSingle();
  if (!current) return c.json(fail(c.get('requestId'), 'INVENTORY_REQUEST_NOT_FOUND', 'ไม่พบคำขอเบิก'), 404);
  if (current.requester_id === c.get('userId')) return c.json(fail(c.get('requestId'), 'INVENTORY_SOD_DENIED', 'ผู้ยื่นคำขอไม่สามารถอนุมัติคำขอของตนเอง'), 403);
  const { data, error } = await createAdminClient(c.env).rpc('approve_inventory_request', {
    request_id_input: c.req.param('id'), approved_input: body.approved, actor_id_input: c.get('userId'), actor_email_input: c.get('userEmail'), request_trace_input: c.get('requestId'), comment_input: body.comment ?? '',
  });
  if (error?.message.includes('INVENTORY_REQUEST_INSUFFICIENT_AVAILABLE')) return c.json(fail(c.get('requestId'), 'INVENTORY_REQUEST_INSUFFICIENT_AVAILABLE', 'สต็อกที่พร้อมจองไม่พอ'), 400);
  if (error) return dbFailJson(c, 'INVENTORY_REQUEST_DECISION_FAILED', error);
  return c.json(ok(c.get('requestId'), data));
});

inventoryItemsRoute.post('/requests/:id/fulfill', requirePermission('inventory.manage'), async (c) => {
  const { data, error } = await createAdminClient(c.env).rpc('fulfill_inventory_request', { request_id_input: c.req.param('id'), actor_id_input: c.get('userId'), actor_email_input: c.get('userEmail'), request_trace_input: c.get('requestId') });
  if (error?.message.includes('INVENTORY_INSUFFICIENT_STOCK')) return c.json(fail(c.get('requestId'), 'INVENTORY_INSUFFICIENT_STOCK', 'สต็อกคงเหลือไม่พอสำหรับคำขอนี้'), 400);
  if (error) return dbFailJson(c, 'INVENTORY_REQUEST_FULFILL_FAILED', error);
  return c.json(ok(c.get('requestId'), data));
});

inventoryItemsRoute.get('/reservations', requirePermission('inventory.view'), zValidator('query', listReservationsQuerySchema, zodValidationHook), async (c) => {
  const { page, pageSize, itemId, status } = c.req.valid('query');
  let query = c.get('supabase').from('inventory_reservations').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (itemId) query = query.eq('item_id', itemId);
  if (status) query = query.eq('status', status);
  const { data, count, error } = await query;
  if (error) return c.json(fail(c.get('requestId'), 'INVENTORY_RESERVATIONS_LIST_FAILED', 'ดึงรายการจองไม่สำเร็จ'), 400);
  return c.json(ok(c.get('requestId'), toPaginatedData(data ?? [], count, page, pageSize)));
});

inventoryItemsRoute.post('/reservations', requirePermission('inventory.manage'), zValidator('json', createReservationSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).rpc('reserve_inventory', {
    item_id_input: body.itemId, reserved_qty_input: body.qty, reserved_by_input: c.get('userId'), actor_email_input: c.get('userEmail'), request_id_input: c.get('requestId'),
    ticket_id_input: body.ticketId ?? null, task_id_input: body.taskId ?? null, source_request_id_input: null, notes_input: body.notes ?? '',
  });
  if (error?.message.includes('INVENTORY_RESERVATION_INSUFFICIENT_AVAILABLE')) return c.json(fail(c.get('requestId'), 'INVENTORY_RESERVATION_INSUFFICIENT_AVAILABLE', 'สต็อกที่พร้อมจองไม่พอ'), 400);
  if (error) return dbFailJson(c, 'INVENTORY_RESERVATION_CREATE_FAILED', error);
  return c.json(ok(c.get('requestId'), data), 201);
});

inventoryItemsRoute.post('/reservations/:id/release', requirePermission('inventory.manage'), async (c) => {
  const { data, error } = await createAdminClient(c.env).rpc('release_inventory_reservation', { reservation_id_input: c.req.param('id'), actor_id_input: c.get('userId'), actor_email_input: c.get('userEmail'), request_trace_input: c.get('requestId') });
  if (error) return dbFailJson(c, 'INVENTORY_RESERVATION_RELEASE_FAILED', error);
  return c.json(ok(c.get('requestId'), data));
});

inventoryItemsRoute.get('/adjustment-requests', requirePermission('inventory.view'), async (c) => {
  const { data, error } = await c.get('supabase').from('inventory_adjustment_requests').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return c.json(fail(c.get('requestId'), 'INVENTORY_ADJUSTMENTS_LIST_FAILED', 'ดึงคำขอปรับยอดไม่สำเร็จ'), 400);
  return c.json(ok(c.get('requestId'), data ?? []));
});

inventoryItemsRoute.post('/adjustment-requests/:id/decision', requirePermission('inventory.approve'), zValidator('json', inventoryDecisionSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data: current } = await c.get('supabase').from('inventory_adjustment_requests').select('requested_by').eq('id', c.req.param('id')).maybeSingle();
  if (!current) return c.json(fail(c.get('requestId'), 'INVENTORY_ADJUSTMENT_NOT_FOUND', 'ไม่พบคำขอปรับยอด'), 404);
  if (current.requested_by === c.get('userId')) return c.json(fail(c.get('requestId'), 'INVENTORY_SOD_DENIED', 'ผู้ขอปรับยอดไม่สามารถอนุมัติรายการเดียวกัน'), 403);
  const { data, error } = await createAdminClient(c.env).rpc('approve_inventory_adjustment', {
    adjustment_id_input: c.req.param('id'), approved_input: body.approved, actor_id_input: c.get('userId'), actor_email_input: c.get('userEmail'), request_trace_input: c.get('requestId'), comment_input: body.comment ?? '',
  });
  if (error?.message.includes('INVENTORY_ADJUSTMENT_STALE')) return c.json(fail(c.get('requestId'), 'INVENTORY_ADJUSTMENT_STALE', 'ยอดสต็อกเปลี่ยนไปแล้ว กรุณานับและส่งคำขอใหม่'), 409);
  if (error) return dbFailJson(c, 'INVENTORY_ADJUSTMENT_DECISION_FAILED', error);
  return c.json(ok(c.get('requestId'), data));
});

inventoryItemsRoute.get('/purchase-receipts', requirePermission('inventory.view'), zValidator('query', listPurchaseReceiptsQuerySchema, zodValidationHook), async (c) => {
  const { page, pageSize, status } = c.req.valid('query');
  let query = c.get('supabase').from('inventory_purchase_receipts').select('*', { count: 'exact' }).order('received_at', { ascending: false }).range(...paginationRange(page, pageSize));
  if (status) query = query.eq('status', status);
  const { data, count, error } = await query;
  if (error) return c.json(fail(c.get('requestId'), 'INVENTORY_RECEIPTS_LIST_FAILED', 'ดึงใบรับซื้อไม่สำเร็จ'), 400);
  return c.json(ok(c.get('requestId'), toPaginatedData(data ?? [], count, page, pageSize)));
});

inventoryItemsRoute.post('/purchase-receipts', requirePermission('inventory.manage'), zValidator('json', createPurchaseReceiptSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const total = body.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
  const { data: receipt, error } = await admin.from('inventory_purchase_receipts').insert({
    receipt_no: body.receiptNo, vendor_id: body.vendorId ?? null, purchase_order_no: body.purchaseOrderNo ?? null,
    received_at: body.receivedAt ?? new Date().toISOString(), total_amount: total, notes: body.notes ?? null, received_by: c.get('userId'), created_by: c.get('userId'),
  }).select().single();
  if (error) return dbFailJson(c, 'INVENTORY_RECEIPT_CREATE_FAILED', error);
  const { error: lineError } = await admin.from('inventory_purchase_receipt_lines').insert(body.lines.map((line) => ({ receipt_id: receipt.id, item_id: line.itemId, received_qty: line.qty, unit_price: line.unitPrice })));
  if (lineError) {
    await admin.from('inventory_purchase_receipts').delete().eq('id', receipt.id);
    return dbFailJson(c, 'INVENTORY_RECEIPT_LINES_FAILED', lineError);
  }
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'CREATE', module: 'inventory', targetTable: 'inventory_purchase_receipts', targetId: receipt.id, detail: { receiptNo: receipt.receipt_no, lineCount: body.lines.length }, requestId: c.get('requestId') });
  return c.json(ok(c.get('requestId'), receipt), 201);
});

inventoryItemsRoute.post('/purchase-receipts/:id/post', requirePermission('inventory.manage'), async (c) => {
  const { data, error } = await createAdminClient(c.env).rpc('post_inventory_purchase_receipt', { receipt_id_input: c.req.param('id'), actor_id_input: c.get('userId'), actor_email_input: c.get('userEmail'), request_trace_input: c.get('requestId') });
  if (error) return dbFailJson(c, 'INVENTORY_RECEIPT_POST_FAILED', error);
  return c.json(ok(c.get('requestId'), data));
});

inventoryItemsRoute.get('/cycle-count-campaigns', requirePermission('inventory.view'), async (c) => {
  const { data, error } = await c.get('supabase').from('inventory_cycle_count_campaigns').select('*').order('scheduled_date', { ascending: false }).limit(100);
  if (error) return c.json(fail(c.get('requestId'), 'INVENTORY_CYCLE_COUNT_LIST_FAILED', 'ดึงแคมเปญนับรอบไม่สำเร็จ'), 400);
  return c.json(ok(c.get('requestId'), data ?? []));
});

inventoryItemsRoute.get('/cycle-count-campaigns/:id', requirePermission('inventory.view'), async (c) => {
  const supabase = c.get('supabase');
  const id = c.req.param('id');
  const [campaign, lines] = await Promise.all([
    supabase.from('inventory_cycle_count_campaigns').select('*').eq('id', id).maybeSingle(),
    supabase.from('inventory_cycle_count_lines').select('*').eq('campaign_id', id).order('item_id'),
  ]);
  if (campaign.error || lines.error) return c.json(fail(c.get('requestId'), 'INVENTORY_CYCLE_COUNT_DETAIL_FAILED', 'ดึงรายละเอียดแคมเปญนับรอบไม่สำเร็จ'), 400);
  if (!campaign.data) return c.json(fail(c.get('requestId'), 'INVENTORY_CYCLE_COUNT_NOT_FOUND', 'ไม่พบแคมเปญนับรอบ'), 404);
  return c.json(ok(c.get('requestId'), { campaign: campaign.data, lines: lines.data ?? [] }));
});

inventoryItemsRoute.post('/cycle-count-campaigns', requirePermission('inventory.manage'), zValidator('json', createCycleCountCampaignSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).rpc('create_inventory_cycle_count_campaign', {
    name_input: body.name, scheduled_date_input: body.scheduledDate ?? null, warehouse_id_input: body.warehouseId ?? null, item_ids_input: body.itemIds, actor_id_input: c.get('userId'),
  });
  if (error) return dbFailJson(c, 'INVENTORY_CYCLE_COUNT_CREATE_FAILED', error);
  return c.json(ok(c.get('requestId'), data), 201);
});

inventoryItemsRoute.post('/cycle-count-campaigns/:id/count', requirePermission('inventory.manage'), zValidator('json', submitCycleCountSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).rpc('submit_inventory_cycle_count', {
    campaign_id_input: c.req.param('id'), item_id_input: body.itemId, counted_qty_input: body.countedQty, actor_id_input: c.get('userId'), notes_input: body.notes ?? '',
  });
  if (error) return dbFailJson(c, 'INVENTORY_CYCLE_COUNT_SUBMIT_FAILED', error);
  return c.json(ok(c.get('requestId'), data));
});

inventoryItemsRoute.post('/cycle-count-campaigns/:id/complete', requirePermission('inventory.manage'), async (c) => {
  const { data, error } = await createAdminClient(c.env).rpc('complete_inventory_cycle_count', {
    campaign_id_input: c.req.param('id'), actor_id_input: c.get('userId'), actor_email_input: c.get('userEmail'), request_trace_input: c.get('requestId'),
  });
  if (error) return dbFailJson(c, 'INVENTORY_CYCLE_COUNT_COMPLETE_FAILED', error);
  if (data?.adjustmentCount) await notifyInventoryApprovers(c.env, { type: 'inventory_adjustment_pending', title: 'Cycle Count สร้างคำขอปรับยอดแล้ว', body: `มี ${data.adjustmentCount} รายการรออนุมัติ`, link: '/inventory-items' });
  return c.json(ok(c.get('requestId'), data));
});

inventoryItemsRoute.post('/warehouses', requirePermission('inventory.manage'), zValidator('json', createWarehouseSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data, error } = await c.get('supabase').from('inventory_warehouses').insert({ code: body.code, name: body.name, address: body.address ?? null, created_by: c.get('userId') }).select().single();
  if (error) return dbFailJson(c, 'INVENTORY_WAREHOUSE_CREATE_FAILED', error);
  return c.json(ok(c.get('requestId'), data), 201);
});

inventoryItemsRoute.post('/bins', requirePermission('inventory.manage'), zValidator('json', createBinSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data, error } = await c.get('supabase').from('inventory_bins').insert({ warehouse_id: body.warehouseId, code: body.code, name: body.name ?? null, created_by: c.get('userId') }).select().single();
  if (error) return dbFailJson(c, 'INVENTORY_BIN_CREATE_FAILED', error);
  return c.json(ok(c.get('requestId'), data), 201);
});
