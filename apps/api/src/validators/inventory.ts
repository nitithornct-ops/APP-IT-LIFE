import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const createInventoryItemSchema = z.object({
  itemName: z.string().trim().min(1, 'กรุณากรอกชื่อรายการ').max(150),
  category: z.string().trim().max(80).optional(),
  unit: z.string().trim().min(1, 'กรุณากรอกหน่วยนับ').max(40),
  stockQty: z.coerce.number().min(0).optional(),
  minQty: z.coerce.number().min(0).optional(),
  reorderPoint: z.coerce.number().min(0).optional(),
  location: z.string().trim().max(120).optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  binId: z.string().uuid().nullable().optional(),
  barcode: z.string().trim().max(120).optional(),
  vendorId: z.string().uuid().nullable().optional(),
  unitPrice: z.coerce.number().min(0).optional(),
  reorderQty: z.coerce.number().min(0).optional(),
  lowStockNotificationEnabled: z.boolean().optional(),
  valuationMethod: z.enum(['STANDARD', 'MOVING_AVERAGE']).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

export const updateInventoryItemSchema = createInventoryItemSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;

export const listInventoryItemsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  lowStockOnly: z.enum(['true', 'false']).optional(),
});
export type ListInventoryItemsQuery = z.infer<typeof listInventoryItemsQuerySchema>;

export const setInventoryItemStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});
export type SetInventoryItemStatusInput = z.infer<typeof setInventoryItemStatusSchema>;

export const recordInventoryTransactionSchema = z.object({
  transactionType: z.enum(['IN', 'OUT']),
  qty: z.coerce.number().positive('จำนวนต้องมากกว่า 0'),
  notes: z.string().trim().max(500).optional(),
  /** Ticket ที่เบิกอะไหล่ไปใช้ — ใส่เมื่อเบิกจากหน้างาน เพื่อให้ยอดที่หายจากคลังตรวจย้อนได้ */
  ticketId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
});
export type RecordInventoryTransactionInput = z.infer<typeof recordInventoryTransactionSchema>;

export const adjustInventoryStockSchema = z.object({
  counted: z.coerce.number().min(0, 'จำนวนนับได้ต้องไม่ติดลบ'),
  notes: z.string().trim().max(500).optional(),
});
export type AdjustInventoryStockInput = z.infer<typeof adjustInventoryStockSchema>;

const inventoryRequestLineSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.coerce.number().positive(),
  notes: z.string().trim().max(500).optional(),
});

export const createInventoryRequestSchema = z.object({
  purpose: z.string().trim().max(500).optional(),
  ticketId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  lines: z.array(inventoryRequestLineSchema).min(1).max(100),
});
export type CreateInventoryRequestInput = z.infer<typeof createInventoryRequestSchema>;

export const listInventoryRequestsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED']).optional(),
  mine: z.enum(['true', 'false']).optional(),
});

export const inventoryDecisionSchema = z.object({
  approved: z.boolean(),
  comment: z.string().trim().max(500).optional(),
});

export const createReservationSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.coerce.number().positive(),
  ticketId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const listReservationsQuerySchema = paginationQuerySchema.extend({
  itemId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'RELEASED', 'FULFILLED', 'CANCELLED']).optional(),
});

export const createPurchaseReceiptSchema = z.object({
  receiptNo: z.string().trim().min(1).max(80),
  vendorId: z.string().uuid().nullable().optional(),
  purchaseOrderNo: z.string().trim().max(80).optional(),
  receivedAt: z.string().datetime().optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    itemId: z.string().uuid(),
    qty: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
  })).min(1).max(100),
});

export const listPurchaseReceiptsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
});

export const createWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(250).optional(),
});

export const createBinSchema = z.object({
  warehouseId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().max(120).optional(),
});

export const createCycleCountCampaignSchema = z.object({
  name: z.string().trim().min(1).max(150),
  scheduledDate: z.string().date().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  itemIds: z.array(z.string().uuid()).min(1).max(1000),
});

export const submitCycleCountSchema = z.object({
  itemId: z.string().uuid(),
  countedQty: z.coerce.number().min(0),
  notes: z.string().trim().max(500).optional(),
});
