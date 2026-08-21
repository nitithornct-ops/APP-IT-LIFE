import { z } from 'zod';

/**
 * อย่างน้อย 2 ตัวอักษร — ตัวอักษรเดียวตรงกับเกือบทุกแถวในทุกตาราง ผลที่ได้ไม่ช่วยผู้ใช้เลย
 * แต่ต้นทุนของฐานข้อมูลเท่ากับการค้นจริงทุกประการ
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'กรุณาพิมพ์อย่างน้อย 2 ตัวอักษร').max(100),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
