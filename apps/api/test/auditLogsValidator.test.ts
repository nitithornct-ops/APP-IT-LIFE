import { describe, expect, it } from 'vitest';
import { auditOverviewQuerySchema, listAuditLogsQuerySchema, listLoginLogsQuerySchema } from '../src/validators/auditLogs';

describe('Audit and Login History filters', () => {
  it('accepts legacy-compatible audit filters', () => {
    const result = listAuditLogsQuerySchema.safeParse({ page: '1', pageSize: '20', module: 'settings', action: 'UPDATE_SETTING', actor: 'admin@example.test', result: 'success', from: '2026-08-01', to: '2026-08-31' });
    expect(result.success).toBe(true);
  });

  it('coerces login success and rejects unsupported results', () => {
    const result = listLoginLogsQuerySchema.parse({ success: 'false' });
    expect(result.success).toBe(false);
    expect(listAuditLogsQuerySchema.safeParse({ result: 'unknown' }).success).toBe(false);
  });

  it('bounds overview periods', () => {
    expect(auditOverviewQuerySchema.parse({}).days).toBe(30);
    expect(auditOverviewQuerySchema.safeParse({ days: '365' }).success).toBe(true);
    expect(auditOverviewQuerySchema.safeParse({ days: '366' }).success).toBe(false);
  });
});
