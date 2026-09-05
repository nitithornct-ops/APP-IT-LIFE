import { createAdminClient } from './supabase';
import type { Bindings } from '../types';

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const BRAND_LABEL = 'LIFE IT SERVICE';
const DEFAULT_ACCENT = '#0F766E';
const NOTIFICATION_ACCENT = '#06A66A';
const MUTED_COLOR = '#8A94A6';
const VALUE_COLOR = '#172033';

export interface LinePushResult {
  success: boolean;
  error: string | null;
}

export interface LineMessagePayload {
  type: string;
  [key: string]: unknown;
}

/** แถว "หัวข้อ — ค่า" ในการ์ด ผู้เรียกส่ง null ได้เลยเมื่อใบงานไม่มีค่านั้น แถวจะถูกตัดทิ้งให้เอง */
export interface LineFlexField {
  label: string;
  value?: string | number | null;
}

interface TicketFlexMessageInput {
  eyebrow: string;
  title: string;
  ticketNo?: string | null;
  status?: string | null;
  /** สถานะก่อนหน้า — แสดงเป็น "เดิม → ใหม่" ให้ผู้อ่านเห็นทิศทางของงานโดยไม่ต้องเปิดใบ */
  previousStatus?: string | null;
  priority?: string | null;
  requesterName?: string | null;
  fields?: readonly (LineFlexField | null | undefined)[];
  detail?: string | null;
  detailLabel?: string;
  rating?: number | null;
  footnote?: string | null;
  url?: string | null;
  accentColor?: string;
  buttonLabel?: string;
}

interface UserNotificationFlexMessageInput {
  title: string;
  body?: string | null;
  url?: string | null;
  /** ชนิดการแจ้งเตือนจากตาราง notifications — กำหนดป้ายหมวดหมู่และสีประจำการ์ด */
  type?: string | null;
  fields?: readonly (LineFlexField | null | undefined)[];
  footnote?: string | null;
  buttonLabel?: string;
}

const TICKET_STATUS_COLORS: Record<string, string> = {
  'ใหม่': '#0F766E',
  'รับเรื่องแล้ว': '#0E7490',
  'กำลังดำเนินการ': '#2563EB',
  'รออะไหล่': '#D97706',
  'รอผู้ใช้งาน': '#D97706',
  'ส่งต่อ Outsource': '#7C3AED',
  'เสร็จสิ้น': '#138A5B',
  'ปิดงาน': '#138A5B',
  'ยกเลิก': '#64748B',
  'ยกระดับเป็น Incident': '#B91C1C',
};

const TICKET_PRIORITY_COLORS: Record<string, string> = {
  'ต่ำ': '#64748B',
  'ปานกลาง': '#2563EB',
  'สูง': '#D97706',
  'วิกฤต': '#DC2626',
};

/**
 * ป้ายหมวดหมู่และสีของการ์ดแจ้งเตือนทั่วไป อิงคอลัมน์ notifications.type ที่มีอยู่แล้ว
 * ผู้รับจึงรู้ตั้งแต่บรรทัดแรกว่าเป็นเรื่องอะไร แทนที่จะเห็นคำว่า "การแจ้งเตือน" เหมือนกันทุกใบ
 */
const NOTIFICATION_PRESETS: Record<string, { label: string; color: string }> = {
  ticket_assigned: { label: 'ได้รับมอบหมายงานแจ้งซ่อม', color: '#2563EB' },
  ticket_status_changed: { label: 'อัปเดตสถานะแจ้งซ่อม', color: '#2563EB' },
  ticket_comment: { label: 'ข้อความใหม่ในใบงาน', color: '#0E7490' },
  ticket_closed: { label: 'ปิดงานเรียบร้อย', color: '#138A5B' },
  ticket_escalated: { label: 'ยกระดับเป็น Incident', color: '#B91C1C' },
  ticket_outsource_response: { label: 'Outsource ตอบกลับ', color: '#7C3AED' },
  response_warning: { label: 'ใกล้ผิด Response SLA', color: '#D97706' },
  response_breached: { label: 'ผิด Response SLA แล้ว', color: '#DC2626' },
  resolution_warning: { label: 'ใกล้ผิด Resolution SLA', color: '#D97706' },
  resolution_breached: { label: 'ผิด Resolution SLA แล้ว', color: '#DC2626' },
  task_reminder: { label: 'เตือนงานของฉัน', color: '#0891B2' },
  workflow_approval: { label: 'มีเอกสารรออนุมัติ', color: '#7C3AED' },
  workflow_result: { label: 'ผลการอนุมัติเอกสาร', color: '#7C3AED' },
  access_request_approval_needed: { label: 'คำขอสิทธิ์รออนุมัติ', color: '#7C3AED' },
  access_request_pending_it: { label: 'คำขอสิทธิ์รอ IT ดำเนินการ', color: '#0E7490' },
  change_requested: { label: 'คำขอเปลี่ยนแปลงระบบ', color: '#7C3AED' },
  change_approval_result: { label: 'ผลอนุมัติการเปลี่ยนแปลง', color: '#7C3AED' },
  change_deployed: { label: 'ติดตั้งการเปลี่ยนแปลงแล้ว', color: '#138A5B' },
  incident_assigned: { label: 'ได้รับมอบหมาย Incident', color: '#DC2626' },
  incident_closed: { label: 'ปิด Incident แล้ว', color: '#138A5B' },
  incident_dpo_screening: { label: 'คัดกรองข้อมูลส่วนบุคคล', color: '#B91C1C' },
  vulnerability_assigned: { label: 'ได้รับมอบหมายช่องโหว่', color: '#DC2626' },
  vulnerability_status: { label: 'อัปเดตสถานะช่องโหว่', color: '#D97706' },
  license_expiry: { label: 'ลิขสิทธิ์ใกล้หมดอายุ', color: '#D97706' },
  contract_expiry: { label: 'สัญญาใกล้หมดอายุ', color: '#D97706' },
  backup_problem: { label: 'ปัญหาการสำรองข้อมูล', color: '#DC2626' },
};

const THAI_DATE_TIME = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
});

/** เวลาทุกจุดในการ์ดเป็นเวลาไทยเสมอ ผู้อ่านบนมือถือไม่ต้องแปลงเขตเวลาเอง */
export function formatThaiDateTime(value?: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${THAI_DATE_TIME.format(date)} น.`;
}

/**
 * ลิงก์กลับเข้าระบบสำหรับปุ่มในการ์ด — คืน null เมื่อ deployment ยังไม่ได้ตั้ง PUBLIC_APP_URL
 * รับเฉพาะ path ที่ขึ้นต้นด้วย "/" เพื่อไม่ให้ลิงก์ที่เก็บไว้ในฐานข้อมูลพาผู้ใช้ออกไปนอกระบบ
 */
export function appUrl(env: Bindings, path: string | null | undefined): string | null {
  if (!env.PUBLIC_APP_URL || !path?.startsWith('/')) return null;
  try {
    return new URL(path.slice(1), `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/`).toString();
  } catch {
    return null;
  }
}

function ticketStatusColor(status?: string | null): string {
  return (status ? TICKET_STATUS_COLORS[status] : null) ?? DEFAULT_ACCENT;
}

function trimmed(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

/** LINE รับสีเฉพาะรูปแบบ #RRGGBB / #RRGGBBAA — สีผิดรูปทำให้ทั้งการ์ดไม่ render จึงต้อง normalize ก่อน */
function normalizeAccent(color: string | undefined, fallback: string): string {
  const value = (color ?? '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(value) ? value : fallback;
}

/** ปลายไล่เฉดของแถบหัวการ์ด ทำให้หัวการ์ดมีมิติแทนที่จะเป็นสีแบนสีเดียว */
function darkenAccent(hex: string, ratio = 0.68): string {
  const channels = [1, 3, 5]
    .map((index) => Math.round(parseInt(hex.slice(index, index + 2), 16) * ratio))
    .map((channel) => channel.toString(16).padStart(2, '0').toUpperCase());
  return `#${channels.join('')}`;
}

function ratingStars(rating?: number | null): string | null {
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0) return null;
  const filled = Math.max(1, Math.min(5, Math.round(rating)));
  return `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}  ${rating.toFixed(1)}/5`;
}

function flexInfoRow(label: string, value: string, valueColor = VALUE_COLOR): Record<string, unknown> {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: MUTED_COLOR, size: 'sm', flex: 4 },
      { type: 'text', text: value, color: valueColor, size: 'sm', flex: 8, wrap: true, weight: 'bold' },
    ],
  };
}

/** จำกัด 10 แถว เพื่อไม่ให้การ์ดยาวเกินจอและไม่ชนเพดาน 10KB ต่อ bubble ของ LINE */
function toInfoRows(fields?: readonly (LineFlexField | null | undefined)[]): Record<string, unknown>[] {
  return (fields ?? [])
    .map((field) => {
      const value = field ? trimmed(field.value, 160) : null;
      return field && value ? flexInfoRow(field.label, value) : null;
    })
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .slice(0, 10);
}

/**
 * แถบสถานะพื้นสีอ่อน อ่านออกตั้งแต่ยังไม่ทันอ่านตัวหนังสือ
 * ใช้แถบเต็มความกว้างแทนป้ายที่หดตามข้อความ เพราะสถานะที่เปลี่ยนแบบยาวสุด
 * ("กำลังดำเนินการ → ยกระดับเป็น Incident") จะถูกตัดหายไปถ้าปล่อยให้ป้ายกว้างเท่าเนื้อหา
 */
function flexStatusPill(text: string, color: string): Record<string, unknown> {
  return {
    type: 'box', layout: 'horizontal', margin: 'md', spacing: 'sm',
    backgroundColor: `${color}14`, cornerRadius: 'md',
    paddingAll: '10px', paddingStart: '12px', paddingEnd: '12px',
    contents: [
      { type: 'text', text: '●', size: 'xxs', color, flex: 0, gravity: 'center' },
      { type: 'text', text, size: 'sm', color, weight: 'bold', wrap: true },
    ],
  };
}

/** ข้อความยาว (รายละเอียดปัญหา / ข้อความสนทนา) อยู่ในกล่องพื้นเทา แยกจากข้อมูลสรุปอย่างชัดเจน */
function flexDetailBlock(label: string, text: string): Record<string, unknown> {
  return {
    type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg',
    backgroundColor: '#F1F5F9', cornerRadius: 'md', paddingAll: '12px',
    contents: [
      { type: 'text', text: label, size: 'xs', color: MUTED_COLOR, weight: 'bold' },
      { type: 'text', text, size: 'sm', color: '#334155', wrap: true, maxLines: 12 },
    ],
  };
}

function flexHeader(accent: string, eyebrow: string, badge: string | null): Record<string, unknown> {
  return {
    type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '18px',
    // backgroundColor เป็นค่าสำรองให้ LINE รุ่นเก่าที่ยังไม่รองรับ background แบบไล่เฉด
    backgroundColor: accent,
    background: { type: 'linearGradient', angle: '135deg', startColor: accent, endColor: darkenAccent(accent) },
    contents: [
      {
        type: 'box', layout: 'baseline',
        contents: [
          { type: 'text', text: BRAND_LABEL, color: '#FFFFFFCC', size: 'xs', weight: 'bold', flex: 0 },
          ...(badge ? [{ type: 'text', text: badge, color: '#FFFFFF', size: 'xs', weight: 'bold', align: 'end' }] : []),
        ],
      },
      { type: 'text', text: eyebrow, color: '#FFFFFF', size: 'lg', weight: 'bold', wrap: true },
    ],
  };
}

function flexFooter(accent: string, url: string | null, buttonLabel: string, footnote: string | null): Record<string, unknown> | null {
  const contents: Record<string, unknown>[] = [];
  if (url) {
    contents.push({
      type: 'button', style: 'primary', height: 'sm', color: accent,
      action: { type: 'uri', label: buttonLabel.slice(0, 40), uri: url },
    });
  }
  if (footnote) {
    contents.push({
      type: 'text', text: footnote, size: 'xxs', color: '#9AA3B2',
      align: 'center', wrap: true, margin: url ? 'md' : 'none',
    });
  }
  return contents.length
    ? { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents }
    : null;
}

function flexBubble(
  altText: string,
  header: Record<string, unknown>,
  body: Record<string, unknown>[],
  footer: Record<string, unknown> | null,
): LineMessagePayload {
  return {
    type: 'flex',
    altText: altText.slice(0, 400),
    contents: {
      type: 'bubble', size: 'mega',
      header,
      body: { type: 'box', layout: 'vertical', paddingAll: '18px', contents: body },
      ...(footer ? { footer, styles: { footer: { separator: true } } } : {}),
    },
  };
}

/**
 * การ์ดมาตรฐานของงานแจ้งซ่อม ใช้ร่วมกันทั้งห้อง LINE ของทีม IT และแชทของผู้แจ้ง
 * ทุกช่องเป็น optional เพราะแต่ละเหตุการณ์รู้ข้อมูลไม่เท่ากัน — ช่องที่ไม่มีค่าจะหายไปทั้งแถว
 * ไม่ทิ้งหัวข้อว่างไว้ให้ผู้อ่านเดา
 */
export function buildTicketFlexMessage(input: TicketFlexMessageInput): LineMessagePayload {
  const status = trimmed(input.status, 60);
  const previousStatus = trimmed(input.previousStatus, 60);
  const priority = trimmed(input.priority, 40);
  const accent = normalizeAccent(input.accentColor, ticketStatusColor(status));
  const eyebrow = trimmed(input.eyebrow, 120) ?? 'แจ้งเตือนงานแจ้งซ่อม';
  const title = trimmed(input.title, 200) ?? 'ไม่ระบุหัวข้อ';
  const ticketNo = trimmed(input.ticketNo, 40);
  const detail = trimmed(input.detail, 900);
  const stars = ratingStars(input.rating);

  const rows = [
    ...(priority ? [flexInfoRow('ความเร่งด่วน', priority, normalizeAccent(TICKET_PRIORITY_COLORS[priority], MUTED_COLOR))] : []),
    ...toInfoRows([{ label: 'ผู้แจ้ง', value: input.requesterName }, ...(input.fields ?? [])]),
    ...(stars ? [flexInfoRow('ผลประเมิน', stars, '#D97706')] : []),
  ];

  return flexBubble(
    [eyebrow, ticketNo ? `[${ticketNo}]` : null, title, status ? `สถานะ: ${status}` : null]
      .filter((part): part is string => Boolean(part)).join(' · '),
    flexHeader(accent, eyebrow, ticketNo),
    [
      { type: 'text', text: title, color: '#111827', size: 'lg', weight: 'bold', wrap: true },
      ...(status ? [flexStatusPill(previousStatus && previousStatus !== status ? `${previousStatus} → ${status}` : status, accent)] : []),
      ...(rows.length ? [
        { type: 'separator', color: '#E5E9F0', margin: 'lg' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: rows },
      ] : []),
      ...(detail ? [flexDetailBlock(input.detailLabel ?? 'รายละเอียด', detail)] : []),
    ],
    flexFooter(accent, input.url ?? null, input.buttonLabel ?? 'ดูรายละเอียด Ticket', trimmed(input.footnote, 160)),
  );
}

/** การ์ดแจ้งเตือนทั่วไปสำหรับผู้ใช้ในระบบที่ผูกบัญชี LINE สถานะ Active ไว้แล้ว */
export function buildUserNotificationFlexMessage(input: UserNotificationFlexMessageInput): LineMessagePayload {
  const preset = NOTIFICATION_PRESETS[trimmed(input.type, 80) ?? ''] ?? { label: 'การแจ้งเตือน', color: NOTIFICATION_ACCENT };
  const accent = normalizeAccent(preset.color, NOTIFICATION_ACCENT);
  const title = trimmed(input.title, 300) ?? 'มีการแจ้งเตือนใหม่';
  const body = trimmed(input.body, 900);
  const rows = toInfoRows(input.fields);

  return flexBubble(
    `LIFE IT · ${preset.label}: ${title}`,
    flexHeader(accent, preset.label, null),
    [
      { type: 'text', text: title, color: '#111827', size: 'md', weight: 'bold', wrap: true },
      ...(rows.length ? [
        { type: 'separator', color: '#E5E9F0', margin: 'lg' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: rows },
      ] : []),
      ...(body ? [flexDetailBlock('รายละเอียด', body)] : []),
    ],
    flexFooter(accent, input.url ?? null, input.buttonLabel ?? 'เปิดดูในระบบ', trimmed(input.footnote, 160)),
  );
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

/** Resolve one application profile to its unique Active LINE identity. */
export async function resolveUserLineTarget(
  env: Bindings,
  recipientId: string,
): Promise<{ target: string; lineUserId: string } | null> {
  const resolved = await resolveTicketRequesterLineTarget(env, null, recipientId);
  return resolved ? { target: resolved.target, lineUserId: resolved.lineUserId } : null;
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
