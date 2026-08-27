import { createAdminClient } from './supabase';
import type { Bindings } from '../types';

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';

export interface LinePushResult {
  success: boolean;
  error: string | null;
}

export interface LineMessagePayload {
  type: string;
  [key: string]: unknown;
}

interface TicketFlexMessageInput {
  eyebrow: string;
  title: string;
  ticketNo?: string | null;
  status?: string | null;
  requesterName?: string | null;
  detail?: string | null;
  url?: string | null;
  accentColor?: string;
  buttonLabel?: string;
}

function ticketStatusColor(status?: string | null): string {
  if (status === 'เสร็จสิ้น' || status === 'ปิดงาน') return '#138A5B';
  if (status === 'ยกเลิก') return '#64748B';
  if (status === 'รออะไหล่' || status === 'รอผู้ใช้งาน' || status === 'ส่งต่อ Outsource') return '#D97706';
  if (status === 'กำลังดำเนินการ') return '#2563EB';
  return '#0F766E';
}

function flexInfoRow(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#64748B', size: 'sm', flex: 3 },
      { type: 'text', text: value, color: '#172033', size: 'sm', flex: 7, wrap: true, weight: 'bold' },
    ],
  };
}

/** Consistent LIFE IT Flex Message card used for ticket and test notifications. */
export function buildTicketFlexMessage(input: TicketFlexMessageInput): LineMessagePayload {
  const accentColor = input.accentColor ?? ticketStatusColor(input.status);
  const infoRows = [
    input.ticketNo ? flexInfoRow('เลขที่', input.ticketNo) : null,
    input.status ? flexInfoRow('สถานะ', input.status) : null,
    input.requesterName ? flexInfoRow('ผู้แจ้ง', input.requesterName) : null,
  ].filter((row): row is Record<string, unknown> => Boolean(row));
  const footer = input.url ? {
    type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
    contents: [{
      type: 'button', style: 'primary', height: 'sm', color: accentColor,
      action: { type: 'uri', label: input.buttonLabel ?? 'ดูรายละเอียด Ticket', uri: input.url },
    }],
  } : undefined;

  return {
    type: 'flex',
    altText: `${input.eyebrow}: ${input.ticketNo ? `${input.ticketNo} ` : ''}${input.title}`.slice(0, 400),
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: accentColor, paddingAll: '16px', spacing: 'sm',
        contents: [
          { type: 'text', text: 'LIFE IT SERVICE', color: '#FFFFFFCC', size: 'xs', weight: 'bold' },
          { type: 'text', text: input.eyebrow, color: '#FFFFFF', size: 'lg', weight: 'bold', wrap: true },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'md',
        contents: [
          { type: 'text', text: input.title, color: '#172033', size: 'md', weight: 'bold', wrap: true },
          ...(infoRows.length ? [{ type: 'separator', color: '#E2E8F0' }, ...infoRows] : []),
          ...(input.detail ? [{ type: 'text', text: input.detail, color: '#475569', size: 'sm', wrap: true, margin: 'md' }] : []),
        ],
      },
      ...(footer ? { footer } : {}),
      styles: { footer: { separator: true } },
    },
  };
}

/**
 * LINE Messaging API push — port of legacy-gas/Notification.gs's sendLinePushDetailed_.
 * Failures never throw into the caller (ticket status updates must succeed even if the push
 * fails); they're logged to notification_log the same way the legacy system's NotificationLog did.
 */
export async function sendLinePush(
  env: Bindings,
  to: string,
  message: string,
  lineUserId?: string | null,
  richMessage?: LineMessagePayload,
): Promise<LinePushResult> {
  if (env.NOTIFY_LINE_ENABLED !== 'true' || !env.LINE_CHANNEL_ACCESS_TOKEN || !to) {
    return { success: false, error: 'LINE Messaging is disabled or incomplete' };
  }
  try {
    const response = await fetch(PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
      body: JSON.stringify({ to, messages: [richMessage ?? { type: 'text', text: message.slice(0, 4900) }] }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = `HTTP ${response.status}: ${body.slice(0, 500)}`;
      await logLineNotification(env, to, message, false, error, lineUserId);
      return { success: false, error };
    }
    await logLineNotification(env, to, message, true, null, lineUserId);
    return { success: true, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logLineNotification(env, to, message, false, errorMessage, lineUserId);
    return { success: false, error: errorMessage };
  }
}

/**
 * Resolve the requester's exact LINE destination. LINE-created tickets carry the LINE row id
 * directly; web-created tickets fall back to the one-to-one profile link selected by an admin.
 * A suspended LINE account never receives a push.
 */
export async function resolveTicketRequesterLineTarget(
  env: Bindings,
  requesterLineUserId: string | null,
  requesterUserId?: string | null,
): Promise<{ target: string; lineUserId: string; linkedUserId: string | null } | null> {
  if (!requesterLineUserId && !requesterUserId) return null;
  const admin = createAdminClient(env);
  let query = admin.from('line_users').select('id, line_user_id, linked_user_id, link_status');
  query = requesterLineUserId
    ? query.eq('id', requesterLineUserId)
    : query.eq('linked_user_id', requesterUserId!);
  const { data } = await query.maybeSingle();
  if (!data || data.link_status !== 'Active') return null;
  return {
    target: data.line_user_id as string,
    lineUserId: data.id as string,
    linkedUserId: (data.linked_user_id as string | null) ?? null,
  };
}

/** `LINE_DEFAULT_TO` is the shared IT-team room — never a substitute for the actual requester's push target. */
export async function notifyTicketTeam(env: Bindings, message: string, richMessage?: LineMessagePayload): Promise<void> {
  if (!env.LINE_DEFAULT_TO) return;
  await sendLinePush(env, env.LINE_DEFAULT_TO, message, null, richMessage);
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
