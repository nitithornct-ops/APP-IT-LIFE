import type { SupabaseClient } from '@supabase/supabase-js';

export const ATTACHMENTS_BUCKET = 'attachments';

/**
 * อัปโหลดไฟล์เข้า bucket "attachments" หลัง route ตรวจสิทธิ์ของ record เป้าหมายแล้ว
 * ตัว route เรียกด้วย Service Role เพราะ browser ถูกห้ามเขียน storage.objects โดยตรง
 * path ยังประกอบจาก userId ฝั่ง server เสมอและไม่รับ path จาก Client
 */
export async function uploadFile(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  /** ชนิดที่ยืนยันจากลายเซ็นในตัวไฟล์แล้ว — ใช้แทน file.type ซึ่งเป็นค่าที่ Client อ้างมาเอง */
  verifiedContentType?: string,
): Promise<{ path: string } | { error: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
    contentType: verifiedContentType ?? file.type ?? 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    return { error: error.message };
  }
  return { path };
}

/** Upload a file after the public Ticket tracking token has been validated by the API. */
export async function uploadPublicTicketFile(
  supabase: SupabaseClient,
  ticketId: string,
  file: File,
  verifiedContentType: string,
): Promise<{ path: string } | { error: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150) || 'attachment';
  const path = `public-ticket/${ticketId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
    contentType: verifiedContentType,
    upsert: false,
  });
  return error ? { error: error.message } : { path };
}

export async function createSignedUrl(
  supabase: SupabaseClient,
  path: string,
  expiresInSeconds: number,
): Promise<{ url: string } | { error: string }> {
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    return { error: error?.message ?? 'สร้าง Signed URL ไม่สำเร็จ' };
  }
  return { url: data.signedUrl };
}

export async function deleteFile(supabase: SupabaseClient, path: string): Promise<{ error?: string }> {
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
  return error ? { error: error.message } : {};
}
