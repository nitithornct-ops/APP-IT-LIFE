import { z } from 'zod';

/** เท่าที่ต้องใช้จริงตอนนี้ (เอกสาร/รูปภาพประกอบงานทั่วไป) — เพิ่มชนิดไฟล์ได้ภายหลังตามความจำเป็นของแต่ละโมดูล */
export const ALLOWED_FILE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
] as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — ตรงกับ file_size_limit ของ bucket

export const uploadFileMetaSchema = z.object({
  module: z.string().trim().min(1).max(50).default('general'),
  targetTable: z.string().trim().max(100).optional(),
  targetId: z.string().trim().max(100).optional(),
});

export const signedUrlQuerySchema = z.object({
  expiresIn: z.coerce.number().int().min(60).max(3600).default(300),
});
