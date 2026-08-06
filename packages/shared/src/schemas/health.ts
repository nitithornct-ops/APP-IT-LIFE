import { z } from 'zod';

export const healthChecksSchema = z.object({
  database: z.enum(['ok', 'error']),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  environment: z.string(),
  timestamp: z.string(),
  checks: healthChecksSchema,
});

export type HealthChecks = z.infer<typeof healthChecksSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
