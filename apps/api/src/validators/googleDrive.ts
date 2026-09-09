import { z } from 'zod';

/**
 * เพดานขนาด CSV ที่ยอมให้ส่งขึ้น Drive ต่อครั้ง
 *
 * นับเป็น "ไบต์" ไม่ใช่จำนวนตัวอักษร เพราะภาษาไทยกินตัวละ 3 ไบต์ใน UTF-8 — ถ้านับเป็นตัวอักษร
 * ไฟล์ภาษาไทยจะโตได้ถึงสามเท่าของเพดานที่ตั้งใจไว้ แล้วไปตายที่ขอบเขตของ Worker แทน
 */
export const MAX_SHEET_CSV_BYTES = 5 * 1024 * 1024;

export const exportToSheetSchema = z.object({
  /** ชื่อไฟล์จากปุ่มส่งออกเดิม (มี .csv ต่อท้าย) — service เป็นคนตัดนามสกุลกับล้างอักขระต้องห้ามเอง */
  filename: z.string().trim().min(1, 'ต้องระบุชื่อไฟล์').max(150, 'ชื่อไฟล์ยาวเกินไป'),
  csv: z
    .string()
    .min(1, 'ไม่มีข้อมูลให้ส่งออก')
    .refine(
      (csv) => new TextEncoder().encode(csv).length <= MAX_SHEET_CSV_BYTES,
      `ข้อมูลที่ส่งออกใหญ่เกิน ${MAX_SHEET_CSV_BYTES / (1024 * 1024)} MB ต่อไฟล์ กรุณากรองให้แคบลงแล้วส่งใหม่`,
    ),
});
