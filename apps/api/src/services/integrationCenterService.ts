import type { Bindings } from '../types';
import { INTEGRATION_RETENTION_DAYS } from './integrationRetentionService';

export type IntegrationStatus = 'active' | 'disabled' | 'incomplete' | 'unavailable' | 'degraded';

export interface NotificationRuleRow {
  id: string;
  rule_code: string;
  event_key: string;
  module_key: string;
  severity: string;
  channel: string;
  recipient: string;
  template_id: string | null;
  enabled: boolean;
  quiet_hours: Record<string, unknown>;
  retry_policy: Record<string, unknown>;
  fallback_channel: string | null;
  escalation_after_minutes: number | null;
  escalation_recipient: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface NotificationTemplateRow {
  id: string;
  template_key: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
  version: number;
  status: string;
}

export interface IntegrationChannelConfigRow {
  channel_key: string;
  enabled: boolean;
  secret_reference: string | null;
  webhook_signing_enabled: boolean;
  idempotency_enabled: boolean;
  rate_limit_per_minute: number;
  last_latency_ms: number | null;
  last_successful_delivery_at: string | null;
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
}

export interface IntegrationOutboxRow {
  id: string;
  integration_code: string;
  event_type: string;
  target_module: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface LineDeliveryRow {
  id: string;
  to_target: string;
  success: boolean;
  error: string | null;
  created_at: string;
}

interface IntegrationCenterInput {
  env: Bindings;
  now?: Date;
  canManage: boolean;
  outboxCounts: Record<string, number>;
  notifications24h: number;
  lineSuccess24h: number;
  lineFailure24h: number;
  activeLineUsers: number;
  outboxRows: IntegrationOutboxRow[];
  lineRows: LineDeliveryRow[];
  ruleRows?: NotificationRuleRow[];
  templateRows?: NotificationTemplateRow[];
  channelRows?: IntegrationChannelConfigRow[];
  deadLetterCount?: number;
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function maskedTarget(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function safeError(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:access_token|token|api_key|key|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(token|secret|api[_-]?key|password)(\s*[=:]\s*)[^\s,;}]+/gi, '$1$2[redacted]')
    .slice(0, 500);
}

function configurationStatus(isEnabled: boolean, required: Array<string | undefined>): IntegrationStatus {
  if (!isEnabled) return 'disabled';
  return required.every((value) => Boolean(value?.trim())) ? 'active' : 'incomplete';
}

function channelLabel(channel: string): string {
  return {
    'in-app': 'In-app Notification',
    'line-messaging': 'LINE Messaging API',
    smtp: 'SMTP / Email',
    teams: 'Microsoft Teams',
    webhook: 'Generic Webhook',
  }[channel] ?? channel;
}

export function buildIntegrationCenter(input: IntegrationCenterInput) {
  const lineLoginStatus = configurationStatus(enabled(input.env.LINE_LOGIN_ENABLED), [
    input.env.LINE_LOGIN_CHANNEL_ID,
    input.env.LINE_LOGIN_CHANNEL_SECRET,
    input.env.LINE_LOGIN_CALLBACK_URL,
    input.env.LINE_SESSION_SECRET,
  ]);
  const lineMessagingStatus = configurationStatus(enabled(input.env.NOTIFY_LINE_ENABLED), [input.env.LINE_CHANNEL_ACCESS_TOKEN]);
  const outboxFailed = (input.outboxCounts.ERROR ?? 0) + (input.outboxCounts.DEAD ?? 0);
  const outboxWaiting = (input.outboxCounts.PENDING ?? 0) + (input.outboxCounts.PROCESSING ?? 0);

  const channels = [
    {
      id: 'in-app', name: 'In-app Notification', status: outboxFailed ? 'degraded' : 'active',
      description: 'กระดิ่งแจ้งเตือนภายในระบบ พร้อมคิว retry แบบ durable',
      delivered24h: input.notifications24h,
      detail: outboxFailed ? `มีคิวผิดพลาด ${outboxFailed} รายการ` : 'พร้อมใช้งาน',
    },
    {
      id: 'line-messaging', name: 'LINE Messaging API', status: lineMessagingStatus,
      description: 'แจ้งผู้ใช้ที่เชื่อมบัญชีและแจ้งทีมเมื่อมีเหตุการณ์สำคัญ',
      delivered24h: input.lineSuccess24h,
      detail: lineMessagingStatus === 'active'
        ? `เชื่อมต่อแล้ว · บัญชีผู้ใช้ Active ${input.activeLineUsers}`
        : lineMessagingStatus === 'incomplete' ? 'เปิดใช้งานแล้ว แต่ secret ยังไม่ครบ' : 'ปิดจาก deployment environment',
    },
    {
      id: 'line-login', name: 'LINE Login', status: lineLoginStatus,
      description: 'ยืนยันตัวตนพอร์ทัลแจ้งงานและผูกกับทะเบียนพนักงาน',
      delivered24h: null,
      detail: lineLoginStatus === 'active'
        ? `พร้อมใช้งาน · บัญชีที่อนุมัติ ${input.activeLineUsers}`
        : lineLoginStatus === 'incomplete' ? 'เปิดใช้งานแล้ว แต่ OAuth configuration ยังไม่ครบ' : 'ปิดจาก deployment environment',
    },
    {
      id: 'smtp', name: 'SMTP / Email', status: 'unavailable',
      description: 'ยังไม่มี email delivery adapter ใน runtime รุ่นนี้', delivered24h: null, detail: 'ยังไม่รองรับ',
    },
    {
      id: 'teams', name: 'Microsoft Teams', status: 'unavailable',
      description: 'ยังไม่มี Teams connector หรือ webhook binding ใน runtime', delivered24h: null, detail: 'ยังไม่รองรับ',
    },
    {
      id: 'webhook', name: 'Generic Webhook', status: 'unavailable',
      description: 'มี Integration Outbox แล้ว แต่ยังไม่มี outbound HTTP adapter', delivered24h: null, detail: 'เตรียมโครงสร้างคิวแล้ว',
    },
  ] satisfies Array<{ id: string; name: string; status: IntegrationStatus; description: string; delivered24h: number | null; detail: string }>;

  const channelConfigs = new Map((input.channelRows ?? []).map((row) => [row.channel_key, row]));
  const enrichedChannels = channels.map((channel) => {
    const config = channelConfigs.get(channel.id);
    const status = config && !config.enabled && channel.status === 'active' ? 'disabled' : channel.status;
    return {
      ...channel,
      status,
      // Keep the action visible for every configured channel. Channels without a
      // runtime adapter return UNAVAILABLE from the test endpoint instead of
      // hiding the operational state from administrators.
      testable: true,
      secretReference: config?.secret_reference ?? null,
      webhookSigningEnabled: config?.webhook_signing_enabled ?? false,
      idempotencyEnabled: config?.idempotency_enabled ?? true,
      rateLimitPerMinute: config?.rate_limit_per_minute ?? null,
      latencyMs: config?.last_latency_ms ?? null,
      lastSuccessfulDeliveryAt: config?.last_successful_delivery_at ?? null,
      lastTestedAt: config?.last_tested_at ?? null,
      lastTestStatus: config?.last_test_status ?? null,
      lastTestError: safeError(config?.last_test_error ?? null),
    };
  });

  const templateNames = new Map((input.templateRows ?? []).map((template) => [template.id, template.name]));
  const configuredRules = input.ruleRows?.map((row) => {
    const ruleChannel = enrichedChannels.find((channel) => channel.id === row.channel);
    return {
      id: row.id,
      ruleCode: row.rule_code,
      event: row.event_key,
      module: row.module_key,
      severity: row.severity,
      channel: channelLabel(row.channel),
      channelKey: row.channel,
      recipients: row.recipient,
      template: row.template_id ? templateNames.get(row.template_id) ?? row.template_id : null,
      enabled: row.enabled,
      quietHours: row.quiet_hours,
      retryPolicy: row.retry_policy,
      fallbackChannel: row.fallback_channel ? channelLabel(row.fallback_channel) : null,
      escalationAfterMinutes: row.escalation_after_minutes,
      escalationRecipient: row.escalation_recipient,
      priority: row.priority,
      status: row.enabled ? (ruleChannel?.status ?? 'unavailable') : 'disabled',
      managedBy: 'database' as const,
    };
  });

  const outboxEvents = input.outboxRows.map((row) => ({
    id: row.id,
    source: 'outbox' as const,
    code: row.integration_code,
    channel: row.target_module,
    eventType: row.event_type,
    status: row.status,
    attempt: `${row.attempt_count}/${row.max_attempts}`,
    error: safeError(row.last_error),
    occurredAt: row.processed_at ?? row.created_at,
    nextAttemptAt: row.next_attempt_at,
    actions: input.canManage
      ? [
          ...(['ERROR', 'DEAD'].includes(row.status) ? ['retry'] : []),
          ...(['PENDING', 'ERROR'].includes(row.status) ? ['cancel'] : []),
        ]
      : [],
  }));
  const lineEvents = input.lineRows.map((row) => ({
    id: row.id,
    source: 'line' as const,
    code: `LINE-${row.id.slice(0, 8)}`,
    channel: `LINE · ${maskedTarget(row.to_target)}`,
    eventType: 'LINE_PUSH',
    status: row.success ? 'COMPLETED' : 'ERROR',
    attempt: '1/1',
    error: safeError(row.error),
    occurredAt: row.created_at,
    nextAttemptAt: null,
    actions: [],
  }));
  const recentEvents = [...outboxEvents, ...lineEvents]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 30);

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    canManage: input.canManage,
    retention: {
      days: INTEGRATION_RETENTION_DAYS,
      scope: 'ลบอัตโนมัติเฉพาะเหตุการณ์ที่จบงานแล้ว ไม่รวม Audit Log และข้อมูลธุรกิจ',
    },
    summary: {
      activeChannels: channels.filter((channel) => channel.status === 'active').length,
      delivered24h: input.notifications24h + input.lineSuccess24h,
      failed24h: input.lineFailure24h,
      outboxWaiting,
      outboxFailed,
    },
    outbox: {
      pending: input.outboxCounts.PENDING ?? 0,
      processing: input.outboxCounts.PROCESSING ?? 0,
      completed: input.outboxCounts.COMPLETED ?? 0,
      error: input.outboxCounts.ERROR ?? 0,
      dead: input.outboxCounts.DEAD ?? 0,
      cancelled: input.outboxCounts.CANCELLED ?? 0,
    },
    channels: enrichedChannels,
    templates: input.templateRows ?? [],
    observability: {
      idempotency: 'integration_outbox.idempotency_key is unique',
      deadLetterCount: input.deadLetterCount ?? input.outboxCounts.DEAD ?? 0,
      configuredChannels: enrichedChannels.filter((channel) => channel.secretReference || channel.id === 'in-app').length,
    },
    rules: configuredRules ?? [
      { id: 'ticket-created-team', event: 'Ticket ใหม่จาก Public / LINE Portal', channel: 'LINE Messaging API', recipients: 'ห้องทีม IT', status: lineMessagingStatus, managedBy: 'code' },
      { id: 'ticket-status-requester', event: 'สถานะ Ticket เปลี่ยน', channel: 'LINE Messaging API', recipients: 'ผู้แจ้งผ่าน LINE', status: lineMessagingStatus, managedBy: 'code' },
      { id: 'linked-user-notification', event: 'การแจ้งเตือนผู้ใช้จากทุกโมดูล', channel: 'In-app + LINE Messaging API', recipients: 'ผู้ใช้ที่เชื่อมบัญชี LINE สถานะ Active', status: lineMessagingStatus, managedBy: 'code' },
      { id: 'access-request', event: 'คำขอสิทธิ์และผลอนุมัติ', channel: 'In-app + LINE', recipients: 'ผู้อนุมัติ / ผู้ร้อง', status: 'active', managedBy: 'code' },
      { id: 'change-flow', event: 'Change ขออนุมัติ / ติดตั้งแล้ว', channel: 'In-app + LINE', recipients: 'ทีมปฏิบัติการ / ผู้ร้อง', status: 'active', managedBy: 'code' },
      { id: 'backup-anomaly', event: 'Backup ล้มเหลวหรือพบ Log anomaly', channel: 'In-app + LINE', recipients: 'ผู้ดูแลระบบ', status: 'active', managedBy: 'code' },
      { id: 'notification-retry', event: 'ส่ง In-app ไม่สำเร็จ', channel: 'Integration Outbox', recipients: 'Cron retry สูงสุด 5 ครั้ง', status: outboxFailed ? 'degraded' : 'active', managedBy: 'code' },
    ],
    recentEvents,
  };
}
