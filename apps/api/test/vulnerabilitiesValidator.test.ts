import { describe, expect, it } from 'vitest';
import {
  createVulnerabilitySchema,
  createVulnerabilityRetestSchema,
  importScannerSchema,
  listVulnerabilitiesQuerySchema,
  requestExceptionSchema,
  setVulnerabilityStatusSchema,
  updateVulnerabilitySchema,
} from '../src/validators/vulnerabilities';

describe('vulnerability validators', () => {
  it('accepts a complete remediation finding', () => {
    const result = createVulnerabilitySchema.parse({
      title: 'OpenSSL remote code execution',
      cve: 'CVE-2026-12345',
      cvss: 9.8,
      severity: 'วิกฤต',
      detectedAt: '2026-08-01',
      dueDate: '2026-08-08',
      evidenceLink: 'https://evidence.example.test/vul-1',
    });
    expect(result.status).toBe('เปิด');
    expect(result.cvss).toBe(9.8);
  });

  it('rejects invalid CVSS, reversed dates and exception without reason', () => {
    expect(createVulnerabilitySchema.safeParse({ title: 'Bad CVSS', cvss: 10.1 }).success).toBe(false);
    expect(createVulnerabilitySchema.safeParse({ title: 'Bad dates', detectedAt: '2026-08-10', dueDate: '2026-08-01' }).success).toBe(false);
    expect(createVulnerabilitySchema.safeParse({ title: 'Bad exception', exceptionExpiry: '2026-12-31' }).success).toBe(false);
  });

  it('requires HTTPS evidence and routes closure through verification', () => {
    expect(createVulnerabilitySchema.safeParse({ title: 'Bad URL', evidenceLink: 'http://unsafe.example.test' }).success).toBe(false);
    expect(createVulnerabilitySchema.safeParse({ title: 'Direct close', status: 'ปิด' }).success).toBe(false);
    expect(setVulnerabilityStatusSchema.safeParse({ status: 'ปิด' }).success).toBe(false);
    expect(setVulnerabilityStatusSchema.safeParse({ status: 'ปิด', evidenceLink: 'https://evidence.example.test/close' }).success).toBe(true);
  });

  it('supports partial edits but rejects an empty patch', () => {
    expect(updateVulnerabilitySchema.safeParse({ remediationPlan: 'Deploy vendor patch' }).success).toBe(true);
    expect(updateVulnerabilitySchema.safeParse({}).success).toBe(false);
  });

  it('coerces pagination and validates list filters', () => {
    expect(listVulnerabilitiesQuerySchema.parse({ page: '2', pageSize: '50', severity: 'สูง' })).toMatchObject({ page: 2, pageSize: 50, severity: 'สูง' });
    expect(listVulnerabilitiesQuerySchema.safeParse({ status: 'ลบแล้ว' }).success).toBe(false);
  });

  it('validates scanner import, risk signals, and retest evidence', () => {
    const imported = importScannerSchema.parse({
      scannerName: 'Nessus',
      rows: [{ externalId: 'plugin-123', title: 'Remote code execution', cvss: '9.8', epssScore: '0.72', kevListed: 'true', internetFacing: '1' }],
    });
    expect(imported.rows[0]).toMatchObject({ cvss: 9.8, epssScore: 0.72, kevListed: true, internetFacing: true });
    expect(createVulnerabilityRetestSchema.safeParse({ status: 'passed', method: 'Authenticated scan' }).success).toBe(false);
    expect(createVulnerabilityRetestSchema.safeParse({ status: 'passed', method: 'Authenticated scan', result: 'No longer exploitable', evidenceLink: 'https://evidence.example.test/retest' }).success).toBe(true);
  });

  it('requires an exception owner and validates exception evidence shape', () => {
    expect(requestExceptionSchema.safeParse({ reason: 'Vendor patch is not yet available', expiresOn: '2026-12-31' }).success).toBe(false);
    expect(requestExceptionSchema.safeParse({ reason: 'Vendor patch is not yet available', expiresOn: '2026-12-31', exceptionOwnerId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
  });
});
