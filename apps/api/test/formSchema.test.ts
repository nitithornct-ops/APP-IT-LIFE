import { describe, expect, it } from 'vitest';
import { missingRequiredFields, sha256Hex } from '../src/services/formSchema';

describe('structured Form field schema', () => {
  const schema = [
    { key: 'kind', label: 'Kind', type: 'select' as const, required: true, options: ['incident', 'request'] },
    { key: 'incident_detail', label: 'Incident detail', type: 'textarea' as const, required: true, condition: { fieldKey: 'kind', operator: 'equals' as const, value: 'incident' } },
    { key: 'confirmed', label: 'Confirmed', type: 'checkbox' as const, required: true },
  ];

  it('validates only visible required fields and treats required checkbox as boolean', () => {
    expect(missingRequiredFields(schema, { kind: 'request', confirmed: false }).map((field) => field.key)).toEqual(['confirmed']);
    expect(missingRequiredFields(schema, { kind: 'incident', confirmed: true }).map((field) => field.key)).toEqual(['incident_detail']);
    expect(missingRequiredFields(schema, { kind: 'incident', incident_detail: 'Root cause', confirmed: true })).toEqual([]);
  });

  it('creates the same evidence hash regardless of object key order', async () => {
    await expect(sha256Hex({ b: 2, a: 1 })).resolves.toBe(await sha256Hex({ a: 1, b: 2 }));
  });
});
