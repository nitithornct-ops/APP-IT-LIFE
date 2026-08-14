import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { writeAuditLog } from '../services/auditService';
import { createSignedUrl, deleteFile, uploadFile } from '../services/storageService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { verifyFileSignature } from '../utils/fileSignature';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  ALLOWED_FILE_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  signedUrlQuerySchema,
  uploadFileMetaSchema,
} from '../validators/files';

export const filesRoute = new Hono<AppEnv>();

filesRoute.use('*', requireAuth);

/**
 * อัปโหลดไฟล์ (multipart/form-data, field name "file") — ไม่ใช้ zValidator('form', ...) เพราะ zod
 * ตรวจสอบ File instance ปนกับ field ข้อความอื่นในฟอร์มเดียวกันได้ไม่ตรงรูปแบบ error มาตรฐาน จึง
 * ตรวจเองตรงนี้แล้วคืน VALIDATION_ERROR รูปแบบเดียวกับ zodValidationHook
 */
filesRoute.post('/', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const userId = c.get('userId');

  const body = await c.req.parseBody();
  const file = body.file;

  if (!(file instanceof File)) {
    return c.json(
      fail(reqId, 'VALIDATION_ERROR', 'ข้อมูลที่ส่งมาไม่ถูกต้อง', [
        { field: 'file', message: 'ต้องแนบไฟล์ (field name: file)' },
      ]),
      400,
    );
  }

  const metaResult = uploadFileMetaSchema.safeParse({
    module: body.module,
    targetTable: body.targetTable,
    targetId: body.targetId,
  });
  if (!metaResult.success) {
    const details = metaResult.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
    return c.json(fail(reqId, 'VALIDATION_ERROR', 'ข้อมูลที่ส่งมาไม่ถูกต้อง', details), 400);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return c.json(fail(reqId, 'FILE_TOO_LARGE', `ไฟล์ต้องมีขนาดไม่เกิน ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`), 400);
  }
  if (!(ALLOWED_FILE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return c.json(fail(reqId, 'FILE_TYPE_NOT_ALLOWED', 'ไม่รองรับชนิดไฟล์นี้'), 400);
  }

  // ชนิดที่ Client ประกาศมาเป็นเพียงคำกล่าวอ้าง ต้องยืนยันด้วยลายเซ็นในตัวไฟล์จริงก่อนเก็บ
  const signature = await verifyFileSignature(file, file.type);
  if (!signature.ok) {
    await writeAuditLog(c.env, {
      actorId: userId,
      actorEmail: c.get('userEmail'),
      action: 'UPLOAD_REJECTED',
      module: 'file',
      targetTable: 'file_attachments',
      detail: { filename: file.name, declaredMimeType: file.type, sizeBytes: file.size, reason: signature.reason },
      result: 'denied',
      requestId: reqId,
    });
    return c.json(fail(reqId, 'FILE_CONTENT_MISMATCH', signature.reason ?? 'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่ระบุ'), 400);
  }

  const uploaded = await uploadFile(supabase, userId, file, signature.resolvedMime);
  if ('error' in uploaded) {
    return c.json(fail(reqId, 'FILE_UPLOAD_FAILED', uploaded.error), 400);
  }

  const { data, error } = await supabase
    .from('file_attachments')
    .insert({
      storage_path: uploaded.path,
      original_filename: file.name,
      mime_type: signature.resolvedMime ?? 'application/octet-stream',
      size_bytes: file.size,
      module: metaResult.data.module,
      target_table: metaResult.data.targetTable ?? null,
      target_id: metaResult.data.targetId ?? null,
      uploaded_by: userId,
    })
    .select()
    .single();

  if (error) {
    await deleteFile(supabase, uploaded.path);
    return c.json(fail(reqId, 'FILE_METADATA_SAVE_FAILED', 'บันทึกข้อมูลไฟล์ไม่สำเร็จ'), 400);
  }

  await writeAuditLog(c.env, {
    actorId: userId,
    actorEmail: c.get('userEmail'),
    action: 'UPLOAD',
    module: 'file',
    targetTable: 'file_attachments',
    targetId: data.id,
    detail: { originalFilename: file.name, sizeBytes: file.size },
    requestId: reqId,
  });

  const signed = await createSignedUrl(supabase, uploaded.path, 300);

  return c.json(ok(reqId, { ...data, signedUrl: 'url' in signed ? signed.url : null }), 201);
});

/** Signed URL อายุสั้น (ค่าเริ่มต้น 300 วินาที) — สร้างใหม่ทุกครั้งที่ขอ ไม่เก็บ URL ถาวรไว้ที่ไหน */
filesRoute.get('/:id/signed-url', zValidator('query', signedUrlQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  const { expiresIn } = c.req.valid('query');

  const { data, error } = await supabase.from('file_attachments').select('storage_path').eq('id', id).single();
  if (error || !data) {
    return c.json(fail(reqId, 'FILE_NOT_FOUND', 'ไม่พบไฟล์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const signed = await createSignedUrl(supabase, data.storage_path, expiresIn);
  if ('error' in signed) {
    return c.json(fail(reqId, 'SIGNED_URL_FAILED', signed.error), 400);
  }

  return c.json(ok(reqId, { url: signed.url, expiresIn }));
});

filesRoute.delete('/:id', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const userId = c.get('userId');
  const id = c.req.param('id');

  const { data, error } = await supabase.from('file_attachments').select('storage_path').eq('id', id).single();
  if (error || !data) {
    return c.json(fail(reqId, 'FILE_NOT_FOUND', 'ไม่พบไฟล์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const removed = await deleteFile(supabase, data.storage_path);
  if (removed.error) {
    return c.json(fail(reqId, 'FILE_DELETE_FAILED', removed.error), 400);
  }

  const { error: deleteError } = await supabase.from('file_attachments').delete().eq('id', id);
  if (deleteError) {
    return dbFailJson(c, 'FILE_DELETE_FAILED', deleteError);
  }

  await writeAuditLog(c.env, {
    actorId: userId,
    actorEmail: c.get('userEmail'),
    action: 'DELETE',
    module: 'file',
    targetTable: 'file_attachments',
    targetId: id,
    requestId: reqId,
  });

  return c.json(ok(reqId, { deleted: true }));
});
