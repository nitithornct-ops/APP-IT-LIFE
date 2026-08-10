import { describe, expect, it } from 'vitest';
import { GOVERNANCE_DOMAINS, governanceSearchText } from './governanceConfig';

describe('governance configuration', () => {
  it('covers all active group E capabilities except the deferred designer surface', () => {
    expect(GOVERNANCE_DOMAINS).toHaveLength(11);
    expect(new Set(GOVERNANCE_DOMAINS.map((item) => item.domain)).size).toBe(11);
  });
  it('builds searchable text from normalized record details', () => {
    expect(governanceSearchText({ id: '1', entity: 'risk', code: 'RSK-1', title: 'Cloud outage', status: 'เปิด', owner: 'IT', details: [{ label: 'Threat', value: 'provider failure' }] })).toContain('provider failure');
  });
});

