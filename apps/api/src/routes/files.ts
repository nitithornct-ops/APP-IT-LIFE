import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { writeAuditLog } from '../services/auditService';
import { automateServiceRequest } from '../services/serviceRequestAutomationService';
import { sendNotification } from '../services/notificationService';
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

const MAX_UPLOAD_REQUEST_BYTES = MAX_FILE_SIZE_BYTES + 1024 * 1024;

type AttachmentMeta =
  | { module: 'ticket'; targetTable: 'tickets'; targetId: string }
  | { module: 'service_request'; targetTable: 'service_requests'; targetId: string }
  | { module: 'asset'; targetTable: 'assets'; targetId: string }
  | { module: 'asset_verification'; targetTable: 'asset_verifications'; targetId: string }
  | { module: 'contract'; targetTable: 'contracts'; targetId: string }
  | { module: 'employee_assignment'; targetTable: 'employee_assignments'; targetId: string }
  | { module: 'asset_loan'; targetTable: 'asset_loans'; targetId: string; stage: 'before' | 'after' };

async function hasPermission(supabase: SupabaseClient, key: string): Promise<boolean> {
  const { data } = await supabase.rpc('has_permission', { permission_key_input: key });
  return data === true;
}

function attachmentMetaFromRow(row: {
  module: string;
  target_table: string | null;
  target_id: string | null;
  asset_loan_stage: string | null;
}): AttachmentMeta | null {
  if (!row.target_id) return null;
  if (row.module === 'ticket' && row.target_table === 'tickets') {
    return { module: 'ticket', targetTable: 'tickets', targetId: row.target_id };
  }
  if (row.module === 'service_request' && row.target_table === 'service_requests') {
    return { module: 'service_request', targetTable: 'service_requests', targetId: row.target_id };
  }
  if (row.module === 'asset' && row.target_table === 'assets') {
    return { module: 'asset', targetTable: 'assets', targetId: row.target_id };
  }
  if (row.module === 'asset_verification' && row.target_table === 'asset_verifications') {
    return { module: 'asset_verification', targetTable: 'asset_verifications', targetId: row.target_id };
  }
  if (row.module === 'contract' && row.target_table === 'contracts') {
    return { module: 'contract', targetTable: 'contracts', targetId: row.target_id };
  }
  if (row.module === 'employee_assignment' && row.target_table === 'employee_assignments') {
    return { module: 'employee_assignment', targetTable: 'employee_assignments', targetId: row.target_id };
  }
  if (row.module === 'asset_loan' && row.target_table === 'asset_loans' && (row.asset_loan_stage === 'before' || row.asset_loan_stage === 'after')) {
    return { module: 'asset_loan', targetTable: 'asset_loans', targetId: row.target_id, stage: row.asset_loan_stage };
  }
  return null;
}

/** ตรวจ record จริง ไม่เชื่อ module/table/id จาก client และไม่อาศัย RLS ที่กว้างกว่าสิทธิ์เขียนไฟล์ */
async function canAccessTarget(
  admin: SupabaseClient,
  userScoped: SupabaseClient,
  userId: string,
  meta: AttachmentMeta,
  action: 'view' | 'write',
): Promise<boolean> {
  if (meta.module === 'ticket' && meta.targetTable === 'tickets') {
    const { data } = await admin.from('tickets').select('requester_id, assignee_id').eq('id', meta.targetId).maybeSingle();
    if (!data) return false;
    if (data.requester_id === userId || data.assignee_id === userId) return true;
    return hasPermission(userScoped, action === 'view' ? 'ticket.view' : 'ticket.update');
  }

  if (meta.module === 'service_request' && meta.targetTable === 'service_requests') {
    const { data } = await admin.from('service_requests').select('requester_id, assignee_id').eq('id', meta.targetId).maybeSingle();
    if (!data) return false;
    if (data.requester_id === userId || data.assignee_id === userId) return true;
    return hasPermission(userScoped, action === 'view' ? 'service_request.view' : 'service_request.update');
  }

  if (meta.module === 'asset' && meta.targetTable === 'assets') {
    const { data } = await admin.from('assets').select('id').eq('id', meta.targetId).maybeSingle();
    if (!data) return false;
    return hasPermission(userScoped, action === 'view' ? 'asset.view' : 'asset.update');
  }

  if (meta.module === 'asset_verification' && meta.targetTable === 'asset_verifications') {
    const { data } = await admin.from('asset_verifications').select('id').eq('id', meta.targetId).maybeSingle();
    if (!data) return false;
    return hasPermission(userScoped, action === 'view' ? 'asset.view' : 'asset.update');
  }

  if (meta.module === 'contract' && meta.targetTable === 'contracts') {
    const { data } = await admin.from('contracts').select('id').eq('id', meta.targetId).maybeSingle();
    if (!data) return false;
    return hasPermission(userScoped, action === 'view' ? 'contract.view' : 'contract.manage');
  }

  if (meta.module === 'employee_assignment' && meta.targetTable === 'employee_assignments') {
    const { data } = await admin.from('employee_assignments').select('id').eq('id', meta.targetId).maybeSingle();
    if (!data) return false;
    return hasPermission(userScoped, action === 'view' ? 'employee.manage' : 'employee.manage');
  }

  if (meta.module === 'asset_loan' && meta.targetTable === 'asset_loans') {
    const { data } = await admin.from('asset_loans').select('id').eq('id', meta.targetId).maybeSingle();
    if (!data) return false;
    return action === 'view'
      ? hasPermission(userScoped, 'asset.view')
      : (await hasPermission(userScoped, 'asset.transfer')) || hasPermission(userScoped, 'asset.update');
  }

  return false;
}

/**
 * อัปโหลดไฟล์ (multipart/form-data, field name "file") — ไม่ใช้ zValidator('form', ...) เพราะ zod
 * ตรวจสอบ File instance ปนกับ field ข้อความอื่นในฟอร์มเดียวกันได้ไม่ตรงรูปแบบ error มาตรฐาน จึง
 * ตรวจเองตรงนี้แล้วคืน VALIDATION_ERROR รูปแบบเดียวกับ zodValidationHook
 */
filesRoute.post(
  '/',
  rateLimit({ windowMs: 3600_000, max: 60, keyFn: (c) => `file_upload:${c.get('userId')}` }),
  bodyLimit({
    maxSize: MAX_UPLOAD_REQUEST_BYTES,
    onError: (c) => c.json(fail(c.get('requestId'), 'FILE_TOO_LARGE', `คำขออัปโหลดต้องมีขนาดไม่เกิน ${MAX_UPLOAD_REQUEST_BYTES / (1024 * 1024)} MB`), 413),
  }),
  async (c) => {
  const userScoped = c.get('supabase');
  const admin = createAdminClient(c.env);
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
    stage: body.stage,
  });
  if (!metaResult.success) {
    const details = metaResult.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
    return c.json(fail(reqId, 'VALIDATION_ERROR', 'ข้อมูลที่ส่งมาไม่ถูกต้อง', details), 400);
  }

  if (!await canAccessTarget(admin, userScoped, userId, metaResult.data, 'write')) {
    return c.json(fail(reqId, 'FILE_TARGET_FORBIDDEN', 'ไม่พบรายการเป้าหมาย หรือท่านไม่มีสิทธิ์แนบไฟล์'), 403);
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

  const uploaded = await uploadFile(admin, userId, file, signature.resolvedMime);
  if ('error' in uploaded) {
    return c.json(fail(reqId, 'FILE_UPLOAD_FAILED', uploaded.error), 400);
  }

  const { data, error } = await admin
    .from('file_attachments')
    .insert({
      storage_path: uploaded.path,
      original_filename: file.name,
      mime_type: signature.resolvedMime ?? 'application/octet-stream',
      size_bytes: file.size,
      module: metaResult.data.module,
      target_table: metaResult.data.targetTable ?? null,
      target_id: metaResult.data.targetId ?? null,
      asset_loan_stage: metaResult.data.module === 'asset_loan' ? metaResult.data.stage : null,
      uploaded_by: userId,
    })
    .select()
    .single();

  if (error) {
    await deleteFile(admin, uploaded.path);
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

  const signed = await createSignedUrl(admin, uploaded.path, 300);

  if (metaResult.data.module === 'service_request') {
    const automation = await automateServiceRequest(c.env, metaResult.data.targetId, userId);
    if (automation.assigneeId) {
      await sendNotification(c.env, {
        recipientId: automation.assigneeId,
        type: 'service_request_assigned',
        title: 'ได้รับมอบหมายคำขอบริการ',
        body: automation.fulfillmentTaskId ? 'ระบบสร้างงานใน My Work ให้แล้ว' : null,
        link: `/service-requests/${metaResult.data.targetId}`,
      });
    }
  }

  return c.json(ok(reqId, { ...data, signedUrl: 'url' in signed ? signed.url : null }), 201);
  },
);

/** Signed URL อายุสั้น (ค่าเริ่มต้น 300 วินาที) — สร้างใหม่ทุกครั้งที่ขอ ไม่เก็บ URL ถาวรไว้ที่ไหน */
filesRoute.get('/:id/signed-url', zValidator('query', signedUrlQuerySchema, zodValidationHook), async (c) => {
  const userScoped = c.get('supabase');
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { expiresIn } = c.req.valid('query');

  const { data, error } = await admin.from('file_attachments')
    .select('storage_path, uploaded_by, module, target_table, target_id, asset_loan_stage').eq('id', id).maybeSingle();
  if (error || !data) {
    return c.json(fail(reqId, 'FILE_NOT_FOUND', 'ไม่พบไฟล์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const ownsFile = data.uploaded_by === userId;
  const targetMeta = attachmentMetaFromRow(data);
  const targetAllowed = targetMeta ? await canAccessTarget(admin, userScoped, userId, targetMeta, 'view') : false;
  if (!ownsFile && !targetAllowed) {
    return c.json(fail(reqId, 'FILE_NOT_FOUND', 'ไม่พบไฟล์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const signed = await createSignedUrl(admin, data.storage_path, expiresIn);
  if ('error' in signed) {
    return c.json(fail(reqId, 'SIGNED_URL_FAILED', signed.error), 400);
  }

  return c.json(ok(reqId, { url: signed.url, expiresIn }));
});

filesRoute.delete('/:id', async (c) => {
  const userScoped = c.get('supabase');
  const admin = createAdminClient(c.env);
  const reqId = c.get('requestId');
  const userId = c.get('userId');
  const id = c.req.param('id');

  const { data, error } = await admin.from('file_attachments')
    .select('storage_path, uploaded_by, module, target_table, target_id, asset_loan_stage').eq('id', id).maybeSingle();
  if (error || !data) {
    return c.json(fail(reqId, 'FILE_NOT_FOUND', 'ไม่พบไฟล์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const ownsFile = data.uploaded_by === userId;
  const targetMeta = attachmentMetaFromRow(data);
  const targetAllowed = targetMeta ? await canAccessTarget(admin, userScoped, userId, targetMeta, 'write') : false;
  if (!ownsFile && !targetAllowed) {
    return c.json(fail(reqId, 'FILE_NOT_FOUND', 'ไม่พบไฟล์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const removed = await deleteFile(admin, data.storage_path);
  if (removed.error) {
    return c.json(fail(reqId, 'FILE_DELETE_FAILED', removed.error), 400);
  }

  const { error: deleteError } = await admin.from('file_attachments').delete().eq('id', id);
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
