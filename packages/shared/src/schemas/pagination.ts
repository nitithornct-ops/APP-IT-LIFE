import { z } from 'zod';

/** Query schema มาตรฐานสำหรับทุก endpoint ที่แบ่งหน้า (list) — ใช้ .extend() ต่อเพื่อเพิ่ม filter เฉพาะจุด */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Query schema มาตรฐานสำหรับการเรียงลำดับ — ใช้ .merge() กับ paginationQuerySchema
 * `sort` เป็นชื่อคอลัมน์ที่ต้องอยู่ใน allowlist ของแต่ละ module เสมอ (ดู applySort ฝั่ง api)
 * schema นี้จึงตรวจแค่รูปแบบ ไม่ได้ตรวจว่าคอลัมน์นั้นมีจริง
 */
export const sortQuerySchema = z.object({
  sort: z.string().trim().max(60).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export type SortQuery = z.infer<typeof sortQuerySchema>;

/** pagination + sort สำหรับ endpoint ที่รองรับทั้งสองอย่าง */
export const listQuerySchema = paginationQuerySchema.merge(sortQuerySchema);

export type ListQuery = z.infer<typeof listQuerySchema>;
