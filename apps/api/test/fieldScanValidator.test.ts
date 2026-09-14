import { describe, expect, it } from 'vitest';
import { fieldScanCampaignCreateSchema, fieldScanSyncSchema } from '../src/validators/assets';

const ASSET_ID = '11111111-1111-4111-8111-111111111111';

describe('field scan validators', () => {
  it('accepts all four field verification outcomes', () => {
    for (const result of ['found', 'not_found', 'wrong_location', 'wrong_custodian']) {
      expect(fieldScanSyncSchema.safeParse({ items: [{ clientRef: 'client-1', assetCode: 'AS-001', result }] }).success).toBe(true);
    }
  });

  it('accepts location and current custodian evidence fields', () => {
    const parsed = fieldScanSyncSchema.safeParse({
      items: [{
        clientRef: 'offline-1', assetCode: 'AS-001', result: 'wrong_custodian',
        expectedLocation: 'อาคาร A', actualLocation: 'อาคาร B',
        expectedCustodianEmployeeId: ASSET_ID, actualCustodianEmployeeId: ASSET_ID,
        note: 'ย้ายโต๊ะแล้ว', scannedAt: '2026-09-12T09:00:00.000Z',
      }],
    });
    expect(parsed.success).toBe(true);
  });

  it('requires a campaign name and at least one sync item', () => {
    expect(fieldScanCampaignCreateSchema.safeParse({ name: 'ตรวจนับปี 2569' }).success).toBe(true);
    expect(fieldScanCampaignCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(fieldScanSyncSchema.safeParse({ items: [] }).success).toBe(false);
  });
});
