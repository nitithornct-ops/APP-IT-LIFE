import { z } from 'zod';

const rangeDays = z.coerce.number().int().min(0).max(3650).default(30);

export const reportRangeQuerySchema = z.object({ rangeDays });
export const reportExportSchema = z.object({ rangeDays }).strict();

/**
 * PDF ส่งออกได้สองแบบในคำขอเดียว: ดาวน์โหลดเสมอ และ "เก็บสำเนาไว้ใน Google Drive" เมื่อผู้ใช้สั่ง
 * ต้องสั่งเองทุกครั้ง ไม่ใช่ค่าเริ่มต้น เพราะการคัดลอกรายงานออกนอกระบบเป็นการตัดสินใจของผู้ใช้
 */
export const reportPdfExportSchema = z.object({ rangeDays, saveToDrive: z.boolean().default(false) }).strict();
