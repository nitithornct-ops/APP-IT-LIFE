import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

export const INTEGRATION_RETENTION_DAYS = 90;

export interface IntegrationRetentionResult {
  skipped: boolean;
  outboxDeleted: number;
  lineLogsDeleted: number;
  outboxRetentionDays: number;
  lineRetentionDays: number;
  runId: string | null;
}

function nonNegative(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function parseIntegrationRetentionResult(value: unknown): IntegrationRetentionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      skipped: true,
      outboxDeleted: 0,
      lineLogsDeleted: 0,
      outboxRetentionDays: INTEGRATION_RETENTION_DAYS,
      lineRetentionDays: INTEGRATION_RETENTION_DAYS,
      runId: null,
    };
  }
  const result = value as Record<string, unknown>;
  return {
    skipped: result.skipped === true,
    outboxDeleted: nonNegative(result.outboxDeleted),
    lineLogsDeleted: nonNegative(result.lineLogsDeleted),
    outboxRetentionDays: positiveInteger(result.outboxRetentionDays, INTEGRATION_RETENTION_DAYS),
    lineRetentionDays: positiveInteger(result.lineRetentionDays, INTEGRATION_RETENTION_DAYS),
    runId: typeof result.runId === 'string' ? result.runId : null,
  };
}

/**
 * Removes only terminal integration history after the governed retention period.
 * The database function performs the deletes in one transaction and records a
 * governance run only when rows were actually removed.
 */
export async function dispatchIntegrationRetention(
  env: Bindings,
  scheduledAt = new Date(),
): Promise<IntegrationRetentionResult> {
  const admin = createAdminClient(env);
  const { data, error } = await admin.rpc('run_automated_integration_retention', {
    scheduled_at_input: scheduledAt.toISOString(),
  });
  if (error) throw new Error(`integration_retention_failed:${error.message}`);
  return parseIntegrationRetentionResult(data);
}
