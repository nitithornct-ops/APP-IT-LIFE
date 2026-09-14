import { describe, expect, it } from 'vitest';
import { auditHashPayload, inferAuditEventCategory, isPrivilegedAuditAction, sha256Hex } from '../src/services/auditService';
import { loginHashPayload } from '../src/services/loginLogService';

describe('audit evidence helpers', () => {
  it('produces a stable SHA-256 hash independent of object key order', async () => {
    await expect(sha256Hex({ b: 2, a: 1 })).resolves.toBe(await sha256Hex({ a: 1, b: 2 }));
    await expect(sha256Hex({ a: 1 })).resolves.not.toBe(await sha256Hex({ a: 2 }));
  });

  it('classifies and flags privileged actions', () => {
    expect(inferAuditEventCategory({ action: 'EXPORT_EVIDENCE_PACKAGE', module: 'audit' })).toBe('export');
    expect(inferAuditEventCategory({ action: 'LOGIN', module: 'auth' })).toBe('authentication');
    expect(inferAuditEventCategory({ action: 'UPDATE_SETTING', module: 'settings' })).toBe('administration');
    expect(isPrivilegedAuditAction({ action: 'EXPORT_EVIDENCE_PACKAGE', module: 'audit' })).toBe(true);
  });

  it('uses the request id as the correlation fallback for login evidence', () => {
    expect(loginHashPayload({ emailAttempted: 'user@example.test', success: true, requestId: 'req-123' })).toMatchObject({
      eventType: 'login_attempt',
      correlationId: 'req-123',
    });
    expect(auditHashPayload({ action: 'READ', module: 'audit', requestId: 'req-123', correlationId: 'corr-123' })).toMatchObject({
      requestId: 'req-123',
      correlationId: 'corr-123',
    });
  });
});
