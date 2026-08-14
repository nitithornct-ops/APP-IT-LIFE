import { describe, expect, it } from 'vitest';
import { publicSubmitTicketSchema, publicTicketStatusQuerySchema } from '../src/validators/publicTickets';

const VALID_CATEGORY_ID = '11111111-1111-4111-8111-111111111111';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    guestName: 'สมชาย ใจดี',
    categoryId: VALID_CATEGORY_ID,
    title: 'เปิดเครื่องไม่ติด',
    description: 'กดปุ่มเปิดแล้วไม่มีไฟขึ้น ลองเสียบปลั๊กใหม่แล้วก็ยังไม่ติด',
    privacyConsent: true,
    ...overrides,
  };
}

describe('public (no-login) ticket submit validator', () => {
  it('accepts a minimal valid guest submission', () => {
    expect(publicSubmitTicketSchema.safeParse(validPayload()).success).toBe(true);
  });

  it('requires guestName, categoryId, title, description and privacyConsent=true', () => {
    expect(publicSubmitTicketSchema.safeParse(validPayload({ guestName: '' })).success).toBe(false);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ categoryId: 'not-a-uuid' })).success).toBe(false);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ title: '' })).success).toBe(false);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ description: '' })).success).toBe(false);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ privacyConsent: false })).success).toBe(false);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ privacyConsent: undefined })).success).toBe(false);
  });

  it('enforces the legacy ticket core limits (200/3000)', () => {
    expect(publicSubmitTicketSchema.safeParse(validPayload({ title: 'x'.repeat(200) })).success).toBe(true);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ title: 'x'.repeat(201) })).success).toBe(false);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ description: 'x'.repeat(3000) })).success).toBe(true);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ description: 'x'.repeat(3001) })).success).toBe(false);
  });

  it('accepts a legacy or current asset code and bounds its length', () => {
    expect(publicSubmitTicketSchema.safeParse(validPayload({ assetCode: 'AST-001' })).success).toBe(true);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ assetCode: 'x'.repeat(81) })).success).toBe(false);
  });

  it('accepts the optional honeypot field so real submissions with it left blank still pass', () => {
    expect(publicSubmitTicketSchema.safeParse(validPayload({ website: '' })).success).toBe(true);
    expect(publicSubmitTicketSchema.safeParse(validPayload({ website: 'http://spambot.example' })).success).toBe(true);
  });
});

describe('public ticket status lookup query validator', () => {
  it('requires a 64-character hex tracking token', () => {
    expect(publicTicketStatusQuerySchema.safeParse({ token: 'a'.repeat(64) }).success).toBe(true);
    expect(publicTicketStatusQuerySchema.safeParse({ token: 'a'.repeat(63) }).success).toBe(false);
    expect(publicTicketStatusQuerySchema.safeParse({ token: 'not-hex-at-all-'.repeat(5) }).success).toBe(false);
    expect(publicTicketStatusQuerySchema.safeParse({}).success).toBe(false);
  });
});
