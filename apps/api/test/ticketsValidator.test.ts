import { describe, expect, it } from 'vitest';
import { createTicketSchema, listTicketsQuerySchema } from '../src/validators/tickets';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';

describe('ticket list filters', () => {
  it('accepts the Help Desk search, category, priority and paging filters', () => {
    const result = listTicketsQuerySchema.safeParse({
      page: '2',
      pageSize: '10',
      search: 'TCK-20260811',
      categoryId: CATEGORY_ID,
      priority: 'วิกฤต',
      status: 'กำลังดำเนินการ',
      mine: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ page: 2, pageSize: 10, priority: 'วิกฤต' });
  });

  it('rejects invalid category, priority and oversized search input', () => {
    expect(listTicketsQuerySchema.safeParse({ categoryId: 'not-uuid' }).success).toBe(false);
    expect(listTicketsQuerySchema.safeParse({ priority: 'ด่วนที่สุด' }).success).toBe(false);
    expect(listTicketsQuerySchema.safeParse({ search: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('ticket create form', () => {
  it('accepts the asset and security fields from the Help Desk modal', () => {
    const result = createTicketSchema.safeParse({
      title: 'เปิดเครื่องไม่ได้',
      categoryId: CATEGORY_ID,
      priority: 'สูง',
      description: 'กดปุ่มแล้วเครื่องไม่ตอบสนอง',
      requesterPhone: '1234',
      location: 'ชั้น 2',
      assetId: '22222222-2222-4222-8222-222222222222',
      isSecurity: true,
    });
    expect(result.success).toBe(true);
  });
});
