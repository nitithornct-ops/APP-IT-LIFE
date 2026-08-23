import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import {
  adjustInventoryStockSchema,
  createInventoryItemSchema,
  listInventoryItemsQuerySchema,
  recordInventoryTransactionSchema,
  setInventoryItemStatusSchema,
  updateInventoryItemSchema,
} from '../validators/inventory';

/**
 * Inventory — อะไหล่/วัสดุสิ้นเปลือง สืบทอดจาก Inventory + InventoryTransactions เดิม รวม CRUD ปกติ
 * (Module_ITAssetExtras.gs: เบิก IN/OUT) กับสต็อกตรวจนับ (Module_InventoryExtras.gs: ADJUST) เป็น
 * transaction_type เดียวกันในตารางเดียว (ทั้งสองเส้นทางอัปเดต StockQty แล้วต่อท้าย ledger เหมือนกัน
 * ทุกประการ ต่างกันแค่วิธีคำนวณ qty) — ดู comment เต็มใน migration 20260814100000_assets.sql
 */
export const inventoryItemsRoute = new Hono<AppEnv>();
inventoryItemsRoute.use('*', requireAuth);

inventoryItemsRoute.get(
  '/',
  requirePermission('inventory.view'),
  zValidator('query', listInventoryItemsQuerySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const { page, pageSize, search, status, lowStockOnly } = c.req.valid('query');

    let query = supabase
      .from('inventory_items')
      .select('*', { count: 'exact' })
      .order('item_name', { ascending: true })
      .range(...paginationRange(page, pageSize));

    if (status) query = query.eq('status', status);
    const safeSearch = search ? cleanSearch(search) : '';
    if (safeSearch) query = query.or(`item_name.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%`);

    const { data, count, error } = await query;
    if (error) return c.json(fail(reqId, 'INVENTORY_LIST_FAILED', 'ดึงรายการ Inventory ไม่สำเร็จ'), 400);

    let items = (data ?? []).map((row) => ({
      ...row,
      low: Number(row.stock_qty) <= Number(row.min_qty),
      value: Number(row.stock_qty) * Number(row.unit_price ?? 0),
    }));
    if (lowStockOnly === 'true') items = items.filter((row) => row.low);

    return c.json(ok(reqId, toPaginatedData(items, count, page, pageSize)));
  },
);

inventoryItemsRoute.get('/:id/transactions', requirePermission('inventory.view'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('*')
    .eq('item_id', id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return c.json(fail(reqId, 'INVENTORY_LEDGER_FAILED', 'ดึงประวัติการเบิก-รับไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data));
});

inventoryItemsRoute.post(
  '/',
  requirePermission('inventory.manage'),
  zValidator('json', createInventoryItemSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('inventory_items')
      .insert({
        item_name: body.itemName,
        category: body.category ?? null,
        unit: body.unit,
        stock_qty: body.stockQty ?? 0,
        min_qty: body.minQty ?? 0,
        location: body.location ?? null,
        unit_price: body.unitPrice ?? null,
        reorder_qty: body.reorderQty ?? null,
        notes: body.notes ?? null,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) return dbFailJson(c, 'INVENTORY_ITEM_CREATE_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'inventory',
      targetTable: 'inventory_items',
      targetId: data.id,
      detail: { itemName: body.itemName },
      requestId: reqId,
    });

    return c.json(ok(reqId, data), 201);
  },
);

inventoryItemsRoute.patch(
  '/:id',
  requirePermission('inventory.manage'),
  zValidator('json', updateInventoryItemSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const body = c.req.valid('json');

    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.itemName !== undefined) patch.item_name = body.itemName;
    if (body.category !== undefined) patch.category = body.category;
    if (body.unit !== undefined) patch.unit = body.unit;
    if (body.minQty !== undefined) patch.min_qty = body.minQty;
    if (body.location !== undefined) patch.location = body.location;
    if (body.unitPrice !== undefined) patch.unit_price = body.unitPrice;
    if (body.reorderQty !== undefined) patch.reorder_qty = body.reorderQty;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status !== undefined) patch.status = body.status;

    const auditBefore = await loadAuditSnapshot(supabase, 'inventory_items', id);
    const { data, error } = await supabase.from('inventory_items').update(patch).eq('id', id).select().single();
    if (error) return dbFailJson(c, 'INVENTORY_ITEM_UPDATE_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'inventory',
      targetTable: 'inventory_items',
      targetId: id,
      detail: body,
      requestId: reqId,
          before: auditBefore,
      after: data,
});

    return c.json(ok(reqId, data));
  },
);

inventoryItemsRoute.post(
  '/:id/status',
  requirePermission('inventory.manage'),
  zValidator('json', setInventoryItemStatusSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { status } = c.req.valid('json');

    const { data, error } = await supabase.from('inventory_items').update({ status, updated_by: actorId }).eq('id', id).select().single();
    if (error) return dbFailJson(c, 'INVENTORY_ITEM_STATUS_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE_STATUS',
      module: 'inventory',
      targetTable: 'inventory_items',
      targetId: id,
      detail: { status },
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);

/** เบิก (OUT) / รับเข้า (IN) — บล็อกถ้าเบิกแล้วสต็อกติดลบ */
inventoryItemsRoute.post(
  '/:id/transactions',
  requirePermission('inventory.manage'),
  zValidator('json', recordInventoryTransactionSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { transactionType, qty, notes, ticketId } = c.req.valid('json');

    const { data, error } = await createAdminClient(c.env).rpc('record_inventory_transaction', {
      item_id_input: id,
      transaction_type_input: transactionType,
      qty_input: qty,
      notes_input: notes ?? '',
      actor_id_input: actorId,
      actor_email_input: c.get('userEmail'),
      request_id_input: reqId,
      ticket_id_input: ticketId ?? null,
    });
    if (error?.message.includes('INVENTORY_ITEM_NOT_FOUND')) {
      return c.json(fail(reqId, 'INVENTORY_ITEM_NOT_FOUND', 'ไม่พบรายการนี้'), 404);
    }
    if (error?.message.includes('INVENTORY_TICKET_NOT_FOUND')) {
      return c.json(fail(reqId, 'INVENTORY_TICKET_NOT_FOUND', 'ไม่พบ Ticket ที่ระบุสำหรับการเบิกครั้งนี้'), 404);
    }
    if (error?.message.includes('INVENTORY_INSUFFICIENT_STOCK')) {
      return c.json(fail(reqId, 'INVENTORY_INSUFFICIENT_STOCK', 'สต็อกคงเหลือไม่พอสำหรับการเบิกครั้งนี้'), 400);
    }
    if (error) return dbFailJson(c, 'INVENTORY_TX_FAILED', error);

    return c.json(ok(reqId, data), 201);
  },
);

/** ตรวจนับสต็อก (Stocktake) — เขียนทับ StockQty ตรงๆ แล้วบันทึกผลต่าง (Variance) ไว้ใน ledger */
inventoryItemsRoute.post(
  '/:id/adjust',
  requirePermission('inventory.manage'),
  zValidator('json', adjustInventoryStockSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id')!;
    const { counted, notes } = c.req.valid('json');

    const { data, error } = await createAdminClient(c.env).rpc('adjust_inventory_stock', {
      item_id_input: id,
      counted_input: counted,
      notes_input: notes ?? '',
      actor_id_input: actorId,
      actor_email_input: c.get('userEmail'),
      request_id_input: reqId,
    });
    if (error?.message.includes('INVENTORY_ITEM_NOT_FOUND')) {
      return c.json(fail(reqId, 'INVENTORY_ITEM_NOT_FOUND', 'ไม่พบรายการนี้'), 404);
    }
    if (error) return dbFailJson(c, 'INVENTORY_ADJUST_FAILED', error);

    return c.json(ok(reqId, data));
  },
);
