import { createAdminClient } from '../lib/supabase';
import { verifyFileSignature } from '../utils/fileSignature';

export const TICKET_SIGNATURE_BUCKET = 'ticket-signatures';
export const MAX_TICKET_SIGNATURE_BYTES = 2 * 1024 * 1024;

type SignatureFailure = { ok: false; code: string; message: string };
type SignatureSuccess = { ok: true; signatureUrl: string | null; uploadedAt: string; path: string };

export async function saveRequesterSignature(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    ticketId: string;
    previousPath?: string | null;
    file: File;
    uploadedBy: string | null;
  },
): Promise<SignatureFailure | SignatureSuccess> {
  if (options.file.type !== 'image/png') {
    return { ok: false, code: 'TICKET_SIGNATURE_TYPE_NOT_ALLOWED', message: 'ลายเซ็นต้องเป็นไฟล์ PNG เท่านั้น' };
  }
  if (options.file.size > MAX_TICKET_SIGNATURE_BYTES) {
    return { ok: false, code: 'TICKET_SIGNATURE_TOO_LARGE', message: 'ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB' };
  }
  const signature = await verifyFileSignature(options.file, 'image/png');
  if (!signature.ok) {
    return { ok: false, code: 'TICKET_SIGNATURE_CONTENT_MISMATCH', message: signature.reason ?? 'เนื้อหาไฟล์ไม่ใช่ PNG' };
  }

  const path = `requesters/${options.ticketId}/${crypto.randomUUID()}.png`;
  const { error: uploadError } = await admin.storage.from(TICKET_SIGNATURE_BUCKET).upload(path, options.file, {
    contentType: 'image/png', cacheControl: '3600', upsert: false,
  });
  if (uploadError) return { ok: false, code: 'TICKET_SIGNATURE_UPLOAD_FAILED', message: 'อัปโหลดลายเซ็นไม่สำเร็จ' };

  const uploadedAt = new Date().toISOString();
  const { error: updateError } = await admin.from('tickets').update({
    requester_signature_storage_path: path,
    requester_signature_uploaded_by: options.uploadedBy,
    requester_signature_uploaded_at: uploadedAt,
  }).eq('id', options.ticketId);
  if (updateError) {
    await admin.storage.from(TICKET_SIGNATURE_BUCKET).remove([path]);
    return { ok: false, code: 'TICKET_SIGNATURE_SAVE_FAILED', message: 'บันทึกลายเซ็นไม่สำเร็จ' };
  }
  if (options.previousPath && options.previousPath !== path) {
    await admin.storage.from(TICKET_SIGNATURE_BUCKET).remove([options.previousPath]);
  }
  const { data: signed } = await admin.storage.from(TICKET_SIGNATURE_BUCKET).createSignedUrl(path, 3600);
  return { ok: true, signatureUrl: signed?.signedUrl ?? null, uploadedAt, path };
}
