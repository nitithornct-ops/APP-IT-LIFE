import { z } from 'zod';

export const integrationChannels = ['in-app', 'line-messaging', 'smtp', 'teams', 'webhook'] as const;
export const notificationSeverities = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;

const channel = z.enum(integrationChannels);
const severity = z.enum(notificationSeverities);

export const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().trim().min(1).max(80),
}).strict();

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(20),
  backoffSeconds: z.number().int().min(1).max(86400),
}).strict();

const ruleFields = {
  ruleCode: z.string().trim().min(3).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/),
  eventKey: z.string().trim().min(3).max(160).regex(/^[a-z0-9][a-z0-9._-]*$/),
  moduleKey: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
  severity,
  channel,
  recipient: z.string().trim().min(1).max(500),
  templateId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
  quietHours: quietHoursSchema.optional(),
  retryPolicy: retryPolicySchema.optional(),
  fallbackChannel: channel.nullable().optional(),
  escalationAfterMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  escalationRecipient: z.string().trim().min(1).max(500).nullable().optional(),
  priority: z.number().int().min(0).max(9999).optional(),
};

export const createNotificationRuleSchema = z.object(ruleFields).strict().superRefine((value, context) => {
  if (value.fallbackChannel === value.channel) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['fallbackChannel'], message: 'Fallback channel must differ from the primary channel' });
  }
  if ((value.escalationAfterMinutes == null) !== (value.escalationRecipient == null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['escalationRecipient'], message: 'Escalation delay and recipient must be provided together' });
  }
});

export const updateNotificationRuleSchema = z.object({
  ...ruleFields,
  ruleCode: ruleFields.ruleCode.optional(),
  eventKey: ruleFields.eventKey.optional(),
  moduleKey: ruleFields.moduleKey.optional(),
  severity: severity.optional(),
  channel: channel.optional(),
  recipient: ruleFields.recipient.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'At least one rule field is required' });

export const createNotificationTemplateSchema = z.object({
  templateKey: z.string().trim().min(3).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().trim().min(2).max(150),
  channel,
  subject: z.string().trim().max(300).nullable().optional(),
  body: z.string().trim().min(1).max(10000),
  variables: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  version: z.number().int().min(1).max(9999).default(1),
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).default('DRAFT'),
}).strict();

export const updateNotificationTemplateSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  channel: channel.optional(),
  subject: z.string().trim().max(300).nullable().optional(),
  body: z.string().trim().min(1).max(10000).optional(),
  variables: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'At least one template field is required' });

export type CreateNotificationRuleInput = z.infer<typeof createNotificationRuleSchema>;
export type UpdateNotificationRuleInput = z.infer<typeof updateNotificationRuleSchema>;
export type CreateNotificationTemplateInput = z.infer<typeof createNotificationTemplateSchema>;
export type UpdateNotificationTemplateInput = z.infer<typeof updateNotificationTemplateSchema>;
