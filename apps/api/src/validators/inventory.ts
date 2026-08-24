import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const createInventoryItemSchema = z.object({
  itemName: z.string().trim().min(1, 'กรุณากรอกชื่อรายการ').max(150),
  category: z.string().trim().max(80).optional(),
  unit: z.string().trim().min(1, 'กรุณากรอกหน่วยนับ').max(40),
  stockQty: z.coerce.number().min(0).optional(),
  minQty: z.coerce.number().min(0).optional(),
  location: z.string().trim().max(120).optional(),
  unitPrice: z.coerce.number().min(0).optional(),
  reorderQty: z.coerce.number().min(0).optional(),
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
});
export type RecordInventoryTransactionInput = z.infer<typeof recordInventoryTransactionSchema>;

export const adjustInventoryStockSchema = z.object({
  counted: z.coerce.number().min(0, 'จำนวนนับได้ต้องไม่ติดลบ'),
  notes: z.string().trim().max(500).optional(),
});
export type AdjustInventoryStockInput = z.infer<typeof adjustInventoryStockSchema>;
