import { createAdminClient } from '../lib/supabase';
import { buildUserNotificationFlexMessage, resolveUserLineTarget, sendLinePush } from '../lib/lineMessaging';
import type { Bindings } from '../types';

export interface NotificationInput {
  recipientId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  /** False when the caller already sends a richer LINE message for this same event. */
  line?: boolean;
}

/**
 * สร้างการแจ้งเตือนในระบบ — ต้องใช้ Service Role เท่านั้น เพราะ notifications ไม่มี insert policy
 * ให้ authenticated (ป้องกันผู้ใช้ปลอมแปลงการแจ้งเตือนให้ผู้อื่น) เช่นเดียวกับ auditService/
 * หากเขียน notifications ไม่สำเร็จ จะเก็บงานไว้ใน durable integration_outbox เพื่อ retry จาก cron
 * และจะ throw เมื่อทั้งการส่งทันทีและการเข้าคิวล้มเหลว เพื่อไม่ให้เหตุการณ์หายแบบเงียบ ๆ
 */
export async function sendNotification(env: Bindings, input: NotificationInput): Promise<void> {
  if (!isValidNotificationPayload(input)) {
    console.warn(JSON.stringify({ msg: 'notification_skipped_invalid_payload' }));
    return;
  }
  const supabase = createAdminClient(env);
  let deliveryError: string;
  try {
    const { error } = await supabase.from('notifications').insert(notificationRow(input));
    if (!error) return;
    deliveryError = error.message;
  } catch (error) {
    deliveryError = error instanceof Error ? error.message : String(error);
  }

  const outboxId = crypto.randomUUID();
  try {
    const { error: queueError } = await supabase.from('integration_outbox').insert({
      integration_code: `NOTIFY-${outboxId}`,
      idempotency_key: `notification:${outboxId}`,
      event_type: 'NOTIFICATION',
      target_module: 'notifications',
      payload: input,
      status: 'PENDING',
      next_attempt_at: new Date().toISOString(),
    });
    if (queueError) throw new Error(queueError.message);
  } catch (queueError) {
    console.error(JSON.stringify({
      msg: 'notification_delivery_and_queue_failed',
      deliveryError,
      queueError: queueError instanceof Error ? queueError.message : String(queueError),
    }));
    throw new Error('NOTIFICATION_QUEUE_FAILED', { cause: queueError });
  }

  console.warn(JSON.stringify({ msg: 'notification_queued_for_retry', outboxId, error: deliveryError }));
}

function notificationUrl(env: Bindings, link: string | null | undefined): string | null {
  if (!env.PUBLIC_APP_URL || !link?.startsWith('/')) return null;
  try {
    return new URL(link, `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/`).toString();
  } catch {
    return null;
  }
}

function notificationRow(input: NotificationInput) {
  return {
    recipient_id: input.recipientId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    send_line: input.line !== false,
  };
}

export function isValidNotificationPayload(input: unknown): input is NotificationInput {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as Partial<NotificationInput>;
  return typeof candidate.recipientId === 'string'
    && candidate.recipientId.trim().length > 0
    && typeof candidate.type === 'string'
    && candidate.type.trim().length > 0
    && typeof candidate.title === 'string'
    && candidate.title.trim().length > 0
    && (candidate.body == null || typeof candidate.body === 'string')
    && (candidate.link == null || typeof candidate.link === 'string')
    && (candidate.line == null || typeof candidate.line === 'boolean');
}

interface NotificationOutboxRow {
  id: string;
  payload: NotificationInput;
  attempt_count: number;
  max_attempts: number;
}

interface LineNotificationOutboxPayload extends NotificationInput {
  notificationId: string;
}

interface LineNotificationOutboxRow {
  id: string;
  payload: LineNotificationOutboxPayload;
  attempt_count: number;
  max_attempts: number;
}

export interface NotificationDispatchResult {
  completed: number;
  failed: number;
  dead: number;
}

export function isValidLineNotificationPayload(input: unknown): input is LineNotificationOutboxPayload {
  return isValidNotificationPayload(input)
    && typeof (input as Partial<LineNotificationOutboxPayload>).notificationId === 'string'
    && Boolean((input as Partial<LineNotificationOutboxPayload>).notificationId?.trim());
}

/** Dispatch queued notifications with a claim-before-send state transition and bounded retry. */
export async function dispatchNotificationOutbox(
  env: Bindings,
  now = new Date(),
): Promise<NotificationDispatchResult> {
  const supabase = createAdminClient(env);
  const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  const { error: recoveryError } = await supabase
    .from('integration_outbox')
    .update({ status: 'ERROR', next_attempt_at: now.toISOString(), last_error: 'stale processing claim recovered' })
    .eq('event_type', 'NOTIFICATION')
    .eq('status', 'PROCESSING')
    .lt('updated_at', staleBefore);
  if (recoveryError) throw new Error(`notification_outbox_recovery_failed: ${recoveryError.message}`);

  const { data, error } = await supabase
    .from('integration_outbox')
    .select('id, payload, attempt_count, max_attempts')
    .eq('event_type', 'NOTIFICATION')
    .in('status', ['PENDING', 'ERROR'])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now.toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw new Error(`notification_outbox_load_failed: ${error.message}`);

  const result: NotificationDispatchResult = { completed: 0, failed: 0, dead: 0 };
  for (const candidate of (data ?? []) as NotificationOutboxRow[]) {
    const nextAttempt = Number(candidate.attempt_count) + 1;
    const { data: claimed, error: claimError } = await supabase
      .from('integration_outbox')
      .update({ status: 'PROCESSING', attempt_count: nextAttempt })
      .eq('id', candidate.id)
      .in('status', ['PENDING', 'ERROR'])
      .select('id')
      .maybeSingle();
    if (claimError) throw new Error(`notification_outbox_claim_failed: ${claimError.message}`);
    if (!claimed) continue;

    const payload = candidate.payload;
    if (!isValidNotificationPayload(payload)) {
      const { error: cancelError } = await supabase.from('integration_outbox').update({
        status: 'CANCELLED',
        cancelled_at: now.toISOString(),
        next_attempt_at: null,
        last_error: 'cancelled: invalid notification payload',
      }).eq('id', candidate.id).eq('status', 'PROCESSING');
      if (cancelError) throw new Error(`notification_outbox_cancel_failed: ${cancelError.message}`);
      result.failed += 1;
      continue;
    }
    const delivery = await supabase.from('notifications').insert(notificationRow(payload));

    if (!delivery.error) {
      const { error: completeError } = await supabase.from('integration_outbox').update({
        status: 'COMPLETED',
        processed_at: now.toISOString(),
        next_attempt_at: null,
        last_error: null,
      }).eq('id', candidate.id).eq('status', 'PROCESSING');
      if (completeError) throw new Error(`notification_outbox_complete_failed: ${completeError.message}`);
      result.completed += 1;
      continue;
    }

    const isDead = nextAttempt >= Number(candidate.max_attempts);
    const retryAt = new Date(now.getTime() + Math.min(60, 2 ** nextAttempt) * 60_000).toISOString();
    const { error: failureError } = await supabase.from('integration_outbox').update({
      status: isDead ? 'DEAD' : 'ERROR',
      next_attempt_at: isDead ? null : retryAt,
      last_error: delivery.error.message.slice(0, 1000),
    }).eq('id', candidate.id).eq('status', 'PROCESSING');
    if (failureError) throw new Error(`notification_outbox_failure_record_failed: ${failureError.message}`);
    result.failed += 1;
    if (isDead) result.dead += 1;
  }

  return result;
}

/**
 * Delivers trigger-created LINE jobs. The database trigger is the single fan-out boundary, so
 * notifications created by routes, task reminder RPCs, and SLA RPCs all receive identical retry
 * and idempotency behavior without delaying the originating request.
 */
export async function dispatchLineNotificationOutbox(
  env: Bindings,
  now = new Date(),
): Promise<NotificationDispatchResult> {
  const result: NotificationDispatchResult = { completed: 0, failed: 0, dead: 0 };
  if (env.NOTIFY_LINE_ENABLED !== 'true' || !env.LINE_CHANNEL_ACCESS_TOKEN) return result;

  const supabase = createAdminClient(env);
  const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  const { error: recoveryError } = await supabase
    .from('integration_outbox')
    .update({ status: 'ERROR', next_attempt_at: now.toISOString(), last_error: 'stale LINE processing claim recovered' })
    .eq('event_type', 'LINE_NOTIFICATION')
    .eq('status', 'PROCESSING')
    .lt('updated_at', staleBefore);
  if (recoveryError) throw new Error(`line_notification_outbox_recovery_failed: ${recoveryError.message}`);

  const { data, error } = await supabase
    .from('integration_outbox')
    .select('id, payload, attempt_count, max_attempts')
    .eq('event_type', 'LINE_NOTIFICATION')
    .in('status', ['PENDING', 'ERROR'])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now.toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw new Error(`line_notification_outbox_load_failed: ${error.message}`);

  for (const candidate of (data ?? []) as LineNotificationOutboxRow[]) {
    const nextAttempt = Number(candidate.attempt_count) + 1;
    const { data: claimed, error: claimError } = await supabase
      .from('integration_outbox')
      .update({ status: 'PROCESSING', attempt_count: nextAttempt })
      .eq('id', candidate.id)
      .in('status', ['PENDING', 'ERROR'])
      .select('id')
      .maybeSingle();
    if (claimError) throw new Error(`line_notification_outbox_claim_failed: ${claimError.message}`);
    if (!claimed) continue;

    const payload = candidate.payload;
    if (!isValidLineNotificationPayload(payload)) {
      const { error: cancelError } = await supabase.from('integration_outbox').update({
        status: 'CANCELLED', cancelled_at: now.toISOString(), next_attempt_at: null,
        last_error: 'cancelled: invalid LINE notification payload',
      }).eq('id', candidate.id).eq('status', 'PROCESSING');
      if (cancelError) throw new Error(`line_notification_outbox_cancel_failed: ${cancelError.message}`);
      result.failed += 1;
      continue;
    }

    const target = await resolveUserLineTarget(env, payload.recipientId);
    if (!target) {
      const { error: completeError } = await supabase.from('integration_outbox').update({
        status: 'COMPLETED', processed_at: now.toISOString(), next_attempt_at: null, last_error: null,
        result_record_id: payload.notificationId,
        result_payload: { skipped: 'no_active_line_link' },
      }).eq('id', candidate.id).eq('status', 'PROCESSING');
      if (completeError) throw new Error(`line_notification_outbox_complete_failed: ${completeError.message}`);
      result.completed += 1;
      continue;
    }

    const text = [payload.title, payload.body]
      .filter((value): value is string => Boolean(value?.trim()))
      .join('\n');
    const delivery = await sendLinePush(
      env,
      target.target,
      text,
      target.lineUserId,
      buildUserNotificationFlexMessage({
        title: payload.title,
        body: payload.body,
        url: notificationUrl(env, payload.link),
      }),
    );

    if (delivery.success) {
      const { error: completeError } = await supabase.from('integration_outbox').update({
        status: 'COMPLETED', processed_at: now.toISOString(), next_attempt_at: null, last_error: null,
        result_record_id: payload.notificationId,
        result_payload: { lineUserId: target.lineUserId },
      }).eq('id', candidate.id).eq('status', 'PROCESSING');
      if (completeError) throw new Error(`line_notification_outbox_complete_failed: ${completeError.message}`);
      result.completed += 1;
      continue;
    }

    const isDead = nextAttempt >= Number(candidate.max_attempts);
    const retryAt = new Date(now.getTime() + Math.min(60, 2 ** nextAttempt) * 60_000).toISOString();
    const { error: failureError } = await supabase.from('integration_outbox').update({
      status: isDead ? 'DEAD' : 'ERROR', next_attempt_at: isDead ? null : retryAt,
      last_error: (delivery.error ?? 'LINE delivery failed').slice(0, 1000),
    }).eq('id', candidate.id).eq('status', 'PROCESSING');
    if (failureError) throw new Error(`line_notification_outbox_failure_record_failed: ${failureError.message}`);
    result.failed += 1;
    if (isDead) result.dead += 1;
  }

  return result;
}
