import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

export interface NotificationInput {
  recipientId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * สร้างการแจ้งเตือนในระบบ — ต้องใช้ Service Role เท่านั้น เพราะ notifications ไม่มี insert policy
 * ให้ authenticated (ป้องกันผู้ใช้ปลอมแปลงการแจ้งเตือนให้ผู้อื่น) เช่นเดียวกับ auditService/
 * loginLogService: ความล้มเหลวของการส่งแจ้งเตือนต้องไม่ทำให้ request หลักล้มตาม จึง catch ไว้ในนี้
 */
export async function sendNotification(env: Bindings, input: NotificationInput): Promise<void> {
  try {
    const supabase = createAdminClient(env);
    const { error } = await supabase.from('notifications').insert({
      recipient_id: input.recipientId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    });

    if (error) {
      console.error(JSON.stringify({ msg: 'notification_write_failed', error: error.message }));
    }
  } catch (err) {
    console.error(JSON.stringify({ msg: 'notification_write_exception', error: String(err) }));
  }
}
