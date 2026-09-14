import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { buildIntegrationCenter, type IntegrationChannelConfigRow, type IntegrationOutboxRow, type LineDeliveryRow, type NotificationRuleRow, type NotificationTemplateRow } from '../services/integrationCenterService';
import type { AppEnv } from '../types';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { createNotificationRuleSchema, createNotificationTemplateSchema, updateNotificationRuleSchema, updateNotificationTemplateSchema } from '../validators/integrations';

const OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'ERROR', 'DEAD', 'CANCELLED'] as const;

export const integrationsRoute = new Hono<AppEnv>();
integrationsRoute.use('*', requireAuth);

integrationsRoute.get('/overview', requirePermission('integration.view'), async (c) => {
  const admin = createAdminClient(c.env);
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [
    recentOutbox,
    recentLine,
    notificationCount,
    lineSuccessCount,
    lineFailureCount,
    activeLineUsersCount,
    notificationRuleRows,
    notificationTemplateRows,
    integrationChannelRows,
    deadLetterCount,
    managePermission,
    ...outboxCountResults
  ] = await Promise.all([
    admin.from('integration_outbox')
      .select('id,integration_code,event_type,target_module,status,attempt_count,max_attempts,next_attempt_at,last_error,created_at,processed_at')
      .order('created_at', { ascending: false }).limit(30),
    admin.from('line_notification_log').select('id,to_target,success,error,created_at').order('created_at', { ascending: false }).limit(30),
    admin.from('notifications').select('id', { count: 'exact', head: true }).gte('created_at', since),
    admin.from('line_notification_log').select('id', { count: 'exact', head: true }).eq('success', true).gte('created_at', since),
    admin.from('line_notification_log').select('id', { count: 'exact', head: true }).eq('success', false).gte('created_at', since),
    admin.from('line_users').select('id', { count: 'exact', head: true }).eq('link_status', 'Active'),
    admin.from('notification_rules').select('*').order('priority', { ascending: true }).order('event_key', { ascending: true }),
    admin.from('notification_templates').select('*').order('template_key', { ascending: true }).order('version', { ascending: false }),
    admin.from('integration_channels').select('*').order('channel_key', { ascending: true }),
    admin.from('integration_dead_letters').select('id', { count: 'exact', head: true }).is('resolved_at', null),
    c.get('supabase').rpc('has_permission', { permission_key_input: 'integration.manage' }),
    ...OUTBOX_STATUSES.map((status) => admin.from('integration_outbox').select('id', { count: 'exact', head: true }).eq('status', status)),
  ]);

  const failed = [recentOutbox, recentLine, notificationCount, lineSuccessCount, lineFailureCount, activeLineUsersCount, notificationRuleRows, notificationTemplateRows, integrationChannelRows, deadLetterCount, ...outboxCountResults].find((result) => result.error);
  if (failed?.error) return dbFailJson(c, 'INTEGRATION_OVERVIEW_LOAD_FAILED', failed.error, 'โหลดสถานะการเชื่อมต่อไม่สำเร็จ');

  const outboxCounts = Object.fromEntries(OUTBOX_STATUSES.map((status, index) => [status, outboxCountResults[index].count ?? 0]));
  return c.json(ok(c.get('requestId'), buildIntegrationCenter({
    env: c.env,
    canManage: !managePermission.error && managePermission.data === true,
    outboxCounts,
    notifications24h: notificationCount.count ?? 0,
    lineSuccess24h: lineSuccessCount.count ?? 0,
    lineFailure24h: lineFailureCount.count ?? 0,
    activeLineUsers: activeLineUsersCount.count ?? 0,
    outboxRows: (recentOutbox.data ?? []) as IntegrationOutboxRow[],
    lineRows: (recentLine.data ?? []) as LineDeliveryRow[],
    ruleRows: (notificationRuleRows.data ?? []) as NotificationRuleRow[],
    templateRows: (notificationTemplateRows.data ?? []) as NotificationTemplateRow[],
    channelRows: (integrationChannelRows.data ?? []) as IntegrationChannelConfigRow[],
    deadLetterCount: deadLetterCount.count ?? 0,
  })));
});

const TESTABLE_CHANNELS = new Set(['in-app', 'line-messaging', 'smtp']);

function safeConnectionError(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]').slice(0, 500);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function runConnectionTest(c: Context<AppEnv>, channel: string) {
  const startedAt = Date.now();
  if (channel === 'in-app') {
    const admin = createAdminClient(c.env);
    const { error } = await admin.from('notifications').select('id', { count: 'exact', head: true });
    return error
      ? { status: 'FAIL' as const, latencyMs: Date.now() - startedAt, error: safeConnectionError(error.message), message: 'Database notification store is not reachable' }
      : { status: 'PASS' as const, latencyMs: Date.now() - startedAt, error: null, message: 'In-app notification store is reachable' };
  }

  if (channel === 'line-messaging') {
    if (!c.env.LINE_CHANNEL_ACCESS_TOKEN) return { status: 'UNAVAILABLE' as const, latencyMs: null, error: 'LINE_CHANNEL_ACCESS_TOKEN is not configured', message: 'Configure the deployment secret first' };
    try {
      const response = await fetchWithTimeout('https://api.line.me/v2/bot/info', { headers: { Authorization: `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}` } });
      return response.ok
        ? { status: 'PASS' as const, latencyMs: Date.now() - startedAt, error: null, message: 'LINE Messaging API is reachable' }
        : { status: 'FAIL' as const, latencyMs: Date.now() - startedAt, error: `LINE responded with HTTP ${response.status}`, message: 'LINE Messaging API rejected the health check' };
    } catch (error) {
      return { status: 'FAIL' as const, latencyMs: Date.now() - startedAt, error: safeConnectionError(error instanceof Error ? error.message : String(error)), message: 'LINE Messaging API health check failed' };
    }
  }

  if (channel === 'smtp') {
    if (!c.env.SMTP_HEALTHCHECK_URL) return { status: 'UNAVAILABLE' as const, latencyMs: null, error: 'SMTP_HEALTHCHECK_URL is not configured', message: 'Configure an HTTPS SMTP health-check endpoint first' };
    try {
      const url = new URL(c.env.SMTP_HEALTHCHECK_URL);
      if (url.protocol !== 'https:') return { status: 'FAIL' as const, latencyMs: Date.now() - startedAt, error: 'SMTP health-check URL must use HTTPS', message: 'SMTP health-check URL is invalid' };
      const response = await fetchWithTimeout(url, { method: 'GET' });
      return response.ok
        ? { status: 'PASS' as const, latencyMs: Date.now() - startedAt, error: null, message: 'SMTP health-check endpoint is reachable' }
        : { status: 'FAIL' as const, latencyMs: Date.now() - startedAt, error: `SMTP health check responded with HTTP ${response.status}`, message: 'SMTP health-check endpoint returned an error' };
    } catch (error) {
      return { status: 'FAIL' as const, latencyMs: Date.now() - startedAt, error: safeConnectionError(error instanceof Error ? error.message : String(error)), message: 'SMTP health check failed' };
    }
  }

  return { status: 'UNAVAILABLE' as const, latencyMs: null, error: `${channel} adapter is not configured`, message: 'This channel does not have a runtime adapter yet' };
}

integrationsRoute.post('/channels/:channel/test', requirePermission('integration.manage'), async (c) => {
  const channel = c.req.param('channel') ?? '';
  const requestId = c.get('requestId');
  if (!TESTABLE_CHANNELS.has(channel) && !['teams', 'webhook'].includes(channel)) return c.json(fail(requestId, 'INTEGRATION_CHANNEL_INVALID', 'Unknown integration channel'), 400);

  const result = await runConnectionTest(c, channel);
  const testedAt = new Date().toISOString();
  const admin = createAdminClient(c.env);
  const { error } = await admin.from('integration_channels').update({
    last_tested_at: testedAt,
    last_test_status: result.status,
    last_test_error: result.error,
    ...(result.latencyMs === null ? {} : { last_latency_ms: result.latencyMs }),
    updated_by: c.get('userId'),
  }).eq('channel_key', channel);
  if (error) return dbFailJson(c, 'INTEGRATION_TEST_RESULT_SAVE_FAILED', error);

  await writeAuditLog(c.env, {
    actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'TEST_CONNECTION', module: 'integration',
    targetTable: 'integration_channels', targetId: channel, detail: { channel, status: result.status, latencyMs: result.latencyMs }, requestId,
  });
  return c.json(ok(requestId, { channel, ...result, testedAt }));
});

integrationsRoute.get('/rules', requirePermission('integration.view'), async (c) => {
  const { data, error } = await createAdminClient(c.env).from('notification_rules').select('*').order('priority').order('event_key');
  if (error) return dbFailJson(c, 'NOTIFICATION_RULES_LIST_FAILED', error);
  return c.json(ok(c.get('requestId'), data ?? []));
});

integrationsRoute.post('/rules', requirePermission('integration.manage'), zValidator('json', createNotificationRuleSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const actorId = c.get('userId');
  const admin = createAdminClient(c.env);
  if (body.templateId) {
    const { data: template, error: templateError } = await admin.from('notification_templates').select('id,channel').eq('id', body.templateId).maybeSingle();
    if (templateError) return dbFailJson(c, 'NOTIFICATION_TEMPLATE_LOOKUP_FAILED', templateError);
    if (!template || template.channel !== body.channel) return c.json(fail(c.get('requestId'), 'NOTIFICATION_TEMPLATE_CHANNEL_MISMATCH', 'Template channel must match the rule channel'), 400);
  }
  const { data, error } = await admin.from('notification_rules').insert({
    rule_code: body.ruleCode, event_key: body.eventKey, module_key: body.moduleKey, severity: body.severity,
    channel: body.channel, recipient: body.recipient, template_id: body.templateId ?? null, enabled: body.enabled ?? true,
    quiet_hours: body.quietHours, retry_policy: body.retryPolicy, fallback_channel: body.fallbackChannel ?? null,
    escalation_after_minutes: body.escalationAfterMinutes ?? null, escalation_recipient: body.escalationRecipient ?? null,
    priority: body.priority ?? 100, created_by: actorId, updated_by: actorId,
  }).select('*').single();
  if (error) return dbFailJson(c, 'NOTIFICATION_RULE_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'integration.notification_rule', targetTable: 'notification_rules', targetId: data.id, detail: { ruleCode: body.ruleCode }, requestId: c.get('requestId'), after: data });
  return c.json(ok(c.get('requestId'), data), 201);
});

integrationsRoute.patch('/rules/:id', requirePermission('integration.manage'), zValidator('json', updateNotificationRuleSchema, zodValidationHook), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const before = await loadAuditSnapshot(admin, 'notification_rules', id);
  if (!before) return c.json(fail(c.get('requestId'), 'NOTIFICATION_RULE_NOT_FOUND', 'Notification rule not found'), 404);
  const patch: Record<string, unknown> = { updated_by: c.get('userId') };
  if (body.ruleCode !== undefined) patch.rule_code = body.ruleCode;
  if (body.eventKey !== undefined) patch.event_key = body.eventKey;
  if (body.moduleKey !== undefined) patch.module_key = body.moduleKey;
  if (body.severity !== undefined) patch.severity = body.severity;
  if (body.channel !== undefined) patch.channel = body.channel;
  if (body.recipient !== undefined) patch.recipient = body.recipient;
  if (body.templateId !== undefined) patch.template_id = body.templateId;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.quietHours !== undefined) patch.quiet_hours = body.quietHours;
  if (body.retryPolicy !== undefined) patch.retry_policy = body.retryPolicy;
  if (body.fallbackChannel !== undefined) patch.fallback_channel = body.fallbackChannel;
  if (body.escalationAfterMinutes !== undefined) patch.escalation_after_minutes = body.escalationAfterMinutes;
  if (body.escalationRecipient !== undefined) patch.escalation_recipient = body.escalationRecipient;
  if (body.priority !== undefined) patch.priority = body.priority;

  const effectiveChannel = String(patch.channel ?? before.channel);
  const effectiveTemplateId = patch.template_id ?? before.template_id;
  if (effectiveTemplateId) {
    const { data: template, error: templateError } = await admin.from('notification_templates').select('id,channel').eq('id', effectiveTemplateId).maybeSingle();
    if (templateError) return dbFailJson(c, 'NOTIFICATION_TEMPLATE_LOOKUP_FAILED', templateError);
    if (!template || template.channel !== effectiveChannel) return c.json(fail(c.get('requestId'), 'NOTIFICATION_TEMPLATE_CHANNEL_MISMATCH', 'Template channel must match the rule channel'), 400);
  }
  const { data, error } = await admin.from('notification_rules').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) return dbFailJson(c, 'NOTIFICATION_RULE_UPDATE_FAILED', error);
  if (!data) return c.json(fail(c.get('requestId'), 'NOTIFICATION_RULE_NOT_FOUND', 'Notification rule not found'), 404);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'integration.notification_rule', targetTable: 'notification_rules', targetId: id, detail: body, requestId: c.get('requestId'), before, after: data });
  return c.json(ok(c.get('requestId'), data));
});

integrationsRoute.delete('/rules/:id', requirePermission('integration.manage'), async (c) => {
  const id = c.req.param('id') ?? '';
  const admin = createAdminClient(c.env);
  const before = await loadAuditSnapshot(admin, 'notification_rules', id);
  if (!before) return c.json(fail(c.get('requestId'), 'NOTIFICATION_RULE_NOT_FOUND', 'Notification rule not found'), 404);
  const { data, error } = await admin.from('notification_rules').update({ enabled: false, updated_by: c.get('userId') }).eq('id', id).select('*').single();
  if (error) return dbFailJson(c, 'NOTIFICATION_RULE_DISABLE_FAILED', error);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'DISABLE', module: 'integration.notification_rule', targetTable: 'notification_rules', targetId: id, requestId: c.get('requestId'), before, after: data });
  return c.json(ok(c.get('requestId'), data));
});

integrationsRoute.get('/templates', requirePermission('integration.view'), async (c) => {
  const { data, error } = await createAdminClient(c.env).from('notification_templates').select('*').order('template_key').order('version', { ascending: false });
  if (error) return dbFailJson(c, 'NOTIFICATION_TEMPLATES_LIST_FAILED', error);
  return c.json(ok(c.get('requestId'), data ?? []));
});

integrationsRoute.post('/templates', requirePermission('integration.manage'), zValidator('json', createNotificationTemplateSchema, zodValidationHook), async (c) => {
  const body = c.req.valid('json');
  const { data, error } = await createAdminClient(c.env).from('notification_templates').insert({
    template_key: body.templateKey, name: body.name, channel: body.channel, subject: body.subject ?? null,
    body: body.body, variables: body.variables, version: body.version, status: body.status,
    created_by: c.get('userId'), updated_by: c.get('userId'),
  }).select('*').single();
  if (error) return dbFailJson(c, 'NOTIFICATION_TEMPLATE_CREATE_FAILED', error);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'CREATE', module: 'integration.notification_template', targetTable: 'notification_templates', targetId: data.id, detail: { templateKey: body.templateKey, channel: body.channel, version: body.version }, requestId: c.get('requestId'), after: data });
  return c.json(ok(c.get('requestId'), data), 201);
});

integrationsRoute.patch('/templates/:id', requirePermission('integration.manage'), zValidator('json', updateNotificationTemplateSchema, zodValidationHook), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = c.req.valid('json');
  const admin = createAdminClient(c.env);
  const before = await loadAuditSnapshot(admin, 'notification_templates', id);
  if (!before) return c.json(fail(c.get('requestId'), 'NOTIFICATION_TEMPLATE_NOT_FOUND', 'Notification template not found'), 404);
  const patch: Record<string, unknown> = { updated_by: c.get('userId') };
  if (body.name !== undefined) patch.name = body.name;
  if (body.channel !== undefined) patch.channel = body.channel;
  if (body.subject !== undefined) patch.subject = body.subject;
  if (body.body !== undefined) patch.body = body.body;
  if (body.variables !== undefined) patch.variables = body.variables;
  if (body.status !== undefined) patch.status = body.status;
  const { data, error } = await admin.from('notification_templates').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) return dbFailJson(c, 'NOTIFICATION_TEMPLATE_UPDATE_FAILED', error);
  if (!data) return c.json(fail(c.get('requestId'), 'NOTIFICATION_TEMPLATE_NOT_FOUND', 'Notification template not found'), 404);
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'integration.notification_template', targetTable: 'notification_templates', targetId: id, detail: body, requestId: c.get('requestId'), before, after: data });
  return c.json(ok(c.get('requestId'), data));
});
