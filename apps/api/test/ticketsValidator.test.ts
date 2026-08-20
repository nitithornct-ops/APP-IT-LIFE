import { describe, expect, it } from 'vitest';
import { addTicketConversationSchema, createTicketSchema, listTicketsQuerySchema, submitTicketFeedbackSchema } from '../src/validators/tickets';
import { ratingsMatchCriteria } from '../src/routes/tickets';

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

describe('ticket satisfaction form', () => {
  const ratings = { responsiveness: 5, workQuality: 4, serviceManners: 5, expertise: 4, communication: 3 };

  it('accepts all five criteria from 1 to 5 with an optional comment', () => {
    expect(submitTicketFeedbackSchema.safeParse({ ratings }).success).toBe(true);
    expect(submitTicketFeedbackSchema.safeParse({ ratings, feedback: 'บริการรวดเร็ว' }).success).toBe(true);
  });

  it('rejects empty criteria and scores outside 1 to 5', () => {
    expect(submitTicketFeedbackSchema.safeParse({ ratings: {} }).success).toBe(false);
    expect(submitTicketFeedbackSchema.safeParse({ ratings: { ...ratings, expertise: 6 } }).success).toBe(false);
  });

  it('requires submitted keys to exactly match the currently active criteria', () => {
    const keys = Object.keys(ratings);
    expect(ratingsMatchCriteria(ratings, keys)).toBe(true);
    expect(ratingsMatchCriteria({ responsiveness: 5 }, keys)).toBe(false);
    expect(ratingsMatchCriteria({ ...ratings, retiredCriterion: 3 }, keys)).toBe(false);
  });
});

describe('ticket conversation form', () => {
  it('accepts public comments and internal notes with bounded content', () => {
    expect(addTicketConversationSchema.safeParse({ message: 'ขอข้อมูลเพิ่ม', visibility: 'public' }).success).toBe(true);
    expect(addTicketConversationSchema.safeParse({ message: 'ตรวจสอบกับทีมระบบ', visibility: 'internal' }).success).toBe(true);
  });

  it('rejects empty and oversized conversation entries', () => {
    expect(addTicketConversationSchema.safeParse({ message: '   ', visibility: 'public' }).success).toBe(false);
    expect(addTicketConversationSchema.safeParse({ message: 'x'.repeat(2001), visibility: 'internal' }).success).toBe(false);
  });
});
