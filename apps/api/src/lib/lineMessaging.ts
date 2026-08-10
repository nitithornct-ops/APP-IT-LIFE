import { createAdminClient } from './supabase';
import type { Bindings } from '../types';

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';

/**
 * LINE Messaging API push — port of legacy-gas/Notification.gs's sendLinePushDetailed_.
 * Failures never throw into the caller (ticket status updates must succeed even if the push
 * fails); they're logged to notification_log the same way the legacy system's NotificationLog did.
 */
export async function sendLinePush(env: Bindings, to: string, message: string, lineUserId?: string | null): Promise<void> {
  if (env.NOTIFY_LINE_ENABLED !== 'true' || !env.LINE_CHANNEL_ACCESS_TOKEN || !to) return;
  try {
    const response = await fetch(PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: message.slice(0, 4900) }] }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      await logLineNotification(env, to, message, false, `HTTP ${response.status}: ${body.slice(0, 500)}`, lineUserId);
      return;
    }
    await logLineNotification(env, to, message, true, null, lineUserId);
  } catch (error) {
    await logLineNotification(env, to, message, false, error instanceof Error ? error.message : String(error), lineUserId);
  }
}

/** Never blocks a ticket update on the requester's linked LINE identity — resolves to null (no push) if unset/not found. */
export async function resolveTicketRequesterLineTarget(env: Bindings, requesterLineUserId: string | null): Promise<{ target: string; lineUserId: string } | null> {
  if (!requesterLineUserId) return null;
  const admin = createAdminClient(env);
  const { data } = await admin.from('line_users').select('id, line_user_id, link_status').eq('id', requesterLineUserId).maybeSingle();
  if (!data || data.link_status !== 'Active') return null;
  return { target: data.line_user_id as string, lineUserId: data.id as string };
}

/** `LINE_DEFAULT_TO` is the shared IT-team room — never a substitute for the actual requester's push target. */
export async function notifyTicketTeam(env: Bindings, message: string): Promise<void> {
  if (!env.LINE_DEFAULT_TO) return;
  await sendLinePush(env, env.LINE_DEFAULT_TO, message);
}

async function logLineNotification(env: Bindings, to: string, message: string, success: boolean, error: string | null, lineUserId?: string | null): Promise<void> {
  try {
    const admin = createAdminClient(env);
    await admin.from('line_notification_log').insert({
      line_user_id: lineUserId ?? null,
      to_target: to,
      message: message.slice(0, 2000),
      success,
      error,
    });
  } catch (err) {
    console.error(JSON.stringify({ msg: 'line_push_log_failed', error: String(err) }));
  }
}
