import { describe, expect, it } from 'vitest';
import { deletionReasonSchema, deletionResourceNames, getDeletionResource } from '../src/routes/recordDeletions';

describe('record deletion allowlist', () => {
  it('maps public resource names to fixed tables and permissions', () => {
    expect(getDeletionResource('assets')).toMatchObject({ table: 'assets', permission: 'asset.dispose' });
    expect(getDeletionResource('access-systems')).toMatchObject({ table: 'access_systems', permission: 'access_system.manage' });
    expect(getDeletionResource('line-links')).toMatchObject({ table: 'line_users', permission: 'line.manage' });
    expect(getDeletionResource('tickets')).toMatchObject({ table: 'tickets', permission: 'ticket.close', mode: 'soft' });
  });

  it('archives governed work and evidence instead of hard deleting it', () => {
    for (const resource of [
      'incidents', 'changes', 'workflow-definitions', 'workflow-instances',
      'backup-logs', 'recovery-tests', 'bcp-plans', 'logging-systems', 'log-reviews',
    ]) {
      expect(getDeletionResource(resource), resource).toMatchObject({ mode: 'archive' });
    }
  });

  it('requires a bounded, non-blank reason for every deletion mutation', () => {
    expect(deletionReasonSchema.safeParse({ reason: '  เก็บตามนโยบาย  ' }).data).toEqual({ reason: 'เก็บตามนโยบาย' });
    expect(deletionReasonSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(deletionReasonSchema.safeParse({}).success).toBe(false);
    expect(deletionReasonSchema.safeParse({ reason: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('never accepts a table name or prototype property supplied by the client', () => {
    expect(getDeletionResource('audit_logs')).toBeUndefined();
    expect(getDeletionResource('login_logs')).toBeUndefined();
    expect(getDeletionResource('__proto__')).toBeUndefined();
    expect(getDeletionResource('constructor')).toBeUndefined();
    expect(getDeletionResource('assets;drop table assets')).toBeUndefined();
  });

  it('keeps immutable evidence tables outside the deletion surface', () => {
    expect(deletionResourceNames).not.toEqual(expect.arrayContaining([
      'audit-logs',
      'login-logs',
      'asset-movements',
      'inventory-transactions',
      'workflow-history',
      'report-exports',
    ]));
  });
});
