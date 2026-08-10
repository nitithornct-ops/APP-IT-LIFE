import { describe, expect, it } from 'vitest';
import { governanceCreateSchemas } from '../src/validators/governance';

describe('governance validators', () => {
  it('requires risk scores within the 5x5 matrix', () => expect(governanceCreateSchemas['risk/risks'].safeParse({ title: 'R', owner: 'IT', likelihood: 6, impact: 1 }).success).toBe(false));
  it('requires explicit policy acknowledgement', () => expect(governanceCreateSchemas['awareness/acknowledgements'].safeParse({ policyName: 'P', policyVersion: '1', signatureName: 'User', confirmed: false }).success).toBe(false));
  it('accepts a governed legal record', () => expect(governanceCreateSchemas['compliance/laws'].safeParse({ lawName: 'PDPA', applicabilityStatus: 'ใช้บังคับ' }).success).toBe(true));
  it('rejects non-HTTPS governance document URLs', () => expect(governanceCreateSchemas['documents/documents'].safeParse({ documentCode: 'POL-1', title: 'Policy', version: '1', documentUrl: 'http://unsafe.test' }).success).toBe(false));
});

