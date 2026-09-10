import { describe, expect, it } from 'vitest';
import { INTEGRATION_RETENTION_DAYS, parseIntegrationRetentionResult } from '../src/services/integrationRetentionService';

describe('Integration retention result parsing', () => {
  it('falls back to the governed 90-day policy for malformed RPC results', () => {
    expect(parseIntegrationRetentionResult(null)).toEqual({
      skipped: true,
      outboxDeleted: 0,
      lineLogsDeleted: 0,
      outboxRetentionDays: INTEGRATION_RETENTION_DAYS,
      lineRetentionDays: INTEGRATION_RETENTION_DAYS,
      runId: null,
    });
  });

  it('normalizes counts and keeps the retention evidence id', () => {
    expect(parseIntegrationRetentionResult({
      skipped: false,
      outboxDeleted: '3',
      lineLogsDeleted: 2,
      outboxRetentionDays: 90,
      lineRetentionDays: 90,
      runId: 'run-1',
    })).toEqual({
      skipped: false,
      outboxDeleted: 3,
      lineLogsDeleted: 2,
      outboxRetentionDays: 90,
      lineRetentionDays: 90,
      runId: 'run-1',
    });
  });
});
