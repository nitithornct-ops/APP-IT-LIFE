import { describe, expect, it } from 'vitest';
import { governanceCreateSchemas } from '../src/validators/governance';

describe('governance validators', () => {
  it('requires risk scores within the 5x5 matrix', () => expect(governanceCreateSchemas['risk/risks'].safeParse({ title: 'R', owner: 'IT', likelihood: 6, impact: 1 }).success).toBe(false));
  it('requires explicit policy acknowledgement', () => expect(governanceCreateSchemas['awareness/acknowledgements'].safeParse({ policyName: 'P', policyVersion: '1', signatureName: 'User', confirmed: false }).success).toBe(false));
  it('accepts a governed legal record', () => expect(governanceCreateSchemas['compliance/laws'].safeParse({ lawName: 'PDPA', applicabilityStatus: 'ใช้บังคับ' }).success).toBe(true));
  it('rejects non-HTTPS governance document URLs', () => expect(governanceCreateSchemas['documents/documents'].safeParse({ documentCode: 'POL-1', title: 'Policy', version: '1', documentUrl: 'http://unsafe.test' }).success).toBe(false));
  it('accepts governed references and rejects a hand-entered non-UUID reference', () => {
    expect(governanceCreateSchemas['compliance/obligations'].safeParse({ lawId: '00000000-0000-0000-0000-000000000001', requirement: 'Keep an evidence trail' }).success).toBe(true);
    expect(governanceCreateSchemas['compliance/obligations'].safeParse({ lawId: 'LAW-2026-01', requirement: 'Keep an evidence trail' }).success).toBe(false);
  });
  it('requires explicit expiry, test and workflow fields for the new P0/P1 records', () => {
    expect(governanceCreateSchemas['risk/risk-acceptances'].safeParse({ riskId: '00000000-0000-0000-0000-000000000001', rationale: 'Temporary exception with compensating controls', expiresAt: '2026-12-31' }).success).toBe(true);
    expect(governanceCreateSchemas['evidence/control-tests'].safeParse({ controlId: '00000000-0000-0000-0000-000000000001', testDate: '2026-09-12', testProcedure: 'Review the sampled access logs', result: 'ผ่าน' }).success).toBe(true);
    expect(governanceCreateSchemas['privacy/dpia'].safeParse({ ropaId: '00000000-0000-0000-0000-000000000001', screeningResult: 'ต้องทำ DPIA', riskLevel: 'สูง', owner: 'dpo@example.test' }).success).toBe(true);
  });
});
