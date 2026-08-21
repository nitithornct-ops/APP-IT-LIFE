import { listQuerySchema, paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const ASSET_TYPES = ['Server', 'Network Device', 'Software/License', 'Endpoint', 'Storage', 'อื่นๆ'] as const;
export const ASSET_CRITICALITIES = ['สูง', 'กลาง', 'ต่ำ'] as const;
export const ASSET_STATUSES = ['พร้อมใช้งาน', 'ใช้งานอยู่', 'ซ่อมบำรุง', 'จำหน่าย/เลิกใช้', 'สูญหาย'] as const;
export const ASSET_AUDIT_RESULTS = ['พบ/ตรงตำแหน่ง', 'พบ/ผิดตำแหน่ง', 'ไม่พบ/สูญหาย'] as const;

const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (yyyy-MM-dd)');
const dateOrEmpty = z.union([isoDateString, z.literal('')]).optional();

export const createAssetSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อทรัพย์สิน').max(150),
  assetCode: z.string().trim().max(60).optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  categoryId: z.string().uuid().optional(),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  serialNumber: z.string().trim().max(100).optional(),
  vendorName: z.string().trim().max(100).optional(),
  vendorId: z.union([z.string().uuid(), z.literal('')]).optional(),
  contractId: z.union([z.string().uuid(), z.literal('')]).optional(),
  purchaseDate: dateOrEmpty,
  warrantyExpire: dateOrEmpty,
  price: z.coerce.number().nonnegative().optional(),
  usefulLifeYears: z.coerce.number().int().positive().max(50).optional(),
  licenseNo: z.string().trim().max(100).optional(),
  licenseExpiry: dateOrEmpty,
  location: z.string().trim().max(120).optional(),
  departmentId: z.string().uuid().optional(),
  ownerEmployeeId: z.string().uuid().optional(),
  patchStatus: z.string().trim().max(60).optional(),
  patchDate: dateOrEmpty,
  criticality: z.enum(ASSET_CRITICALITIES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  notes: z.string().trim().max(500).optional(),
  remark: z.string().trim().max(500).optional(),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = createAssetSchema.partial();
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const listAssetsQuerySchema = listQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.string().trim().max(60).optional(),
  categoryId: z.string().uuid().optional(),
});
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

export const assetBorrowOverviewQuerySchema = paginationQuerySchema.extend({
  view: z.enum(['active', 'history']).default('active'),
  search: z.string().trim().max(200).optional(),
  departmentId: z.string().uuid().optional(),
});
export type AssetBorrowOverviewQuery = z.infer<typeof assetBorrowOverviewQuerySchema>;

export const setAssetStatusSchema = z.object({
  status: z.enum(ASSET_STATUSES),
  remark: z.string().trim().max(200).optional(),
});
export type SetAssetStatusInput = z.infer<typeof setAssetStatusSchema>;

export const updateAssetPatchSchema = z.object({
  patchStatus: z.string().trim().max(60),
  patchDate: dateOrEmpty,
});
export type UpdateAssetPatchInput = z.infer<typeof updateAssetPatchSchema>;

export const verifyAssetSchema = z.object({
  result: z.enum(ASSET_AUDIT_RESULTS),
  location: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
});
export type VerifyAssetInput = z.infer<typeof verifyAssetSchema>;

// ===== Borrow / Return / Transfer / Repair — ผูกกับพนักงานจริง (employees) แทน free text ตามที่ระบุ
// ไว้ใน comment ของ migration (Asset/Ticket ต้องการ owner ที่ถูกต้อง) =====

export const assignAssetSchema = z.object({
  toEmployeeId: z.string().uuid('กรุณาเลือกผู้รับ/ผู้ถือครอง'),
  departmentId: z.string().uuid().optional(),
  location: z.string().trim().max(120).optional(),
  dueDate: dateOrEmpty,
  notes: z.string().trim().max(500).optional(),
});
export type AssignAssetInput = z.infer<typeof assignAssetSchema>;

export const returnAssetSchema = z.object({
  location: z.string().trim().max(120).optional(),
  condition: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type ReturnAssetInput = z.infer<typeof returnAssetSchema>;

export const transferAssetSchema = z
  .object({
    toEmployeeId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    location: z.string().trim().max(120).optional(),
    dueDate: dateOrEmpty,
    notes: z.string().trim().max(500).optional(),
  })
  .refine((data) => Boolean(data.toEmployeeId || data.departmentId || data.location), {
    message: 'กรุณาระบุผู้รับ หรือแผนก/สถานที่ปลายทาง',
    path: ['toEmployeeId'],
  });
export type TransferAssetInput = z.infer<typeof transferAssetSchema>;

export const sendAssetToRepairSchema = z.object({
  vendorName: z.string().trim().max(160).optional(),
  vendorId: z.string().uuid().optional(),
  location: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type SendAssetToRepairInput = z.infer<typeof sendAssetToRepairSchema>;

export const returnAssetFromRepairSchema = z.object({
  location: z.string().trim().max(120).optional(),
  condition: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type ReturnAssetFromRepairInput = z.infer<typeof returnAssetFromRepairSchema>;

/**
 * สถานะที่เปลี่ยนทีละหลายชิ้นได้ — จงใจไม่รวม "จำหน่าย/เลิกใช้" กับ "สูญหาย"
 * ทั้งสองอย่างเป็นการนำของออกจากทะเบียนใช้งาน ต้องใช้สิทธิ์ asset.dispose และต้องบันทึก
 * เหตุผลรายชิ้น การกดครั้งเดียวแล้วปลดของ 50 ชิ้นออกจากทะเบียนพร้อมกันเป็นความเสี่ยงที่ไม่คุ้ม
 */
export const BULK_ASSET_STATUSES = ['พร้อมใช้งาน', 'ใช้งานอยู่', 'ซ่อมบำรุง'] as const;

export const bulkUpdateAssetsSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1, 'กรุณาเลือกทรัพย์สินอย่างน้อย 1 รายการ').max(50, 'เลือกได้สูงสุด 50 รายการต่อครั้ง'),
    status: z.enum(BULK_ASSET_STATUSES).optional(),
    location: z.string().trim().min(1).max(120).optional(),
    /** null = คืนของ (ล้างผู้ถือครอง) — uuid = มอบหมายให้พนักงานคนนั้น */
    ownerEmployeeId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((body) => body.status !== undefined || body.location !== undefined || body.ownerEmployeeId !== undefined, {
    message: 'กรุณาเลือกสิ่งที่ต้องการเปลี่ยน',
    path: ['status'],
  });
export type BulkUpdateAssetsInput = z.infer<typeof bulkUpdateAssetsSchema>;
