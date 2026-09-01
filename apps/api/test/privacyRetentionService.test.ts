import { describe, expect, it } from 'vitest';
import { parsePrivacyRetentionApplyResult } from '../src/services/privacyRetentionService';

describe('parsePrivacyRetentionApplyResult', () => {
  it('normalizes database counters without accepting negative or malformed values', () => {
    expect(parsePrivacyRetentionApplyResult({ ticketsAnonymized: 3, attachmentMetadataDeleted: '4' }))
      .toEqual({ ticketsAnonymized: 3, attachmentMetadataDeleted: 4 });
    expect(parsePrivacyRetentionApplyResult({ ticketsAnonymized: -1, attachmentMetadataDeleted: 'nope' }))
      .toEqual({ ticketsAnonymized: 0, attachmentMetadataDeleted: 0 });
    expect(parsePrivacyRetentionApplyResult(null))
      .toEqual({ ticketsAnonymized: 0, attachmentMetadataDeleted: 0 });
  });
});
