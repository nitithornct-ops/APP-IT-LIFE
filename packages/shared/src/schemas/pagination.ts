import { z } from 'zod';

/** Query schema มาตรฐานสำหรับทุก endpoint ที่แบ่งหน้า (list) — ใช้ .extend() ต่อเพื่อเพิ่ม filter เฉพาะจุด */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
