import { z } from 'zod';

export const healthChecksSchema = z.object({
  database: z.enum(['ok', 'error']),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  timestamp: z.string(),
  responseTimeMs: z.number().int().nonnegative(),
});

export type HealthChecks = z.infer<typeof healthChecksSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const systemStatusComponentSchema = z.object({
  id: z.enum([
    'api',
    'database',
    'supabase_auth',
    'storage',
    'cloudflare_worker',
    'line_messaging',
    'smtp',
    'google_drive',
    'scheduled_jobs',
    'outbox_queue',
  ]),
  name: z.string(),
  status: z.enum(['operational', 'degraded', 'down', 'not_configured', 'unknown']),
  critical: z.boolean(),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  checkedAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  lastFailureReason: z.string().nullable(),
  uptime: z.object({
    hours24: z.number().nullable(),
    days7: z.number().nullable(),
    days30: z.number().nullable(),
  }),
  averageResponseTimeMs: z.object({
    hours24: z.number().nullable(),
    days7: z.number().nullable(),
    days30: z.number().nullable(),
  }),
});

export const systemStatusIncidentSchema = z.object({
  id: z.string(),
  component: z.string(),
  componentName: z.string(),
  status: z.enum(['open', 'resolved']),
  severity: z.enum(['minor', 'major', 'critical']),
  title: z.string(),
  summary: z.string(),
  startedAt: z.string(),
  lastFailureAt: z.string(),
  resolvedAt: z.string().nullable(),
  failureCount: z.number().int().nonnegative(),
});

export const systemStatusResponseSchema = z.object({
  overallStatus: z.enum(['operational', 'degraded', 'down', 'unknown']),
  generatedAt: z.string(),
  responseTimeMs: z.number().int().nonnegative(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    operational: z.number().int().nonnegative(),
    degraded: z.number().int().nonnegative(),
    down: z.number().int().nonnegative(),
    notConfigured: z.number().int().nonnegative(),
    openIncidents: z.number().int().nonnegative(),
  }),
  targets: z.object({
    sloPercent: z.number(),
    slaPercent: z.number(),
    responseTimeMs: z.number().int().positive(),
  }),
  components: z.array(systemStatusComponentSchema),
  incidents: z.array(systemStatusIncidentSchema),
});

export type SystemStatusComponent = z.infer<typeof systemStatusComponentSchema>;
export type SystemStatusIncident = z.infer<typeof systemStatusIncidentSchema>;
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;
