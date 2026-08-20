import { describe, expect, it } from 'vitest';
import {
  createTicketRatingCriterionSchema,
  updateTicketRatingCriterionSchema,
} from '../src/validators/ticketRatingCriteria';

describe('ticket rating criteria validators', () => {
  it('accepts an administrator-created criterion', () => {
    expect(createTicketRatingCriterionSchema.safeParse({
      label: 'ความสะอาดหลังซ่อม',
      description: 'พื้นที่ทำงานเรียบร้อยหลังให้บริการ',
      sortOrder: 60,
    }).success).toBe(true);
  });

  it('rejects blank labels, invalid order and empty updates', () => {
    expect(createTicketRatingCriterionSchema.safeParse({ label: '   ' }).success).toBe(false);
    expect(createTicketRatingCriterionSchema.safeParse({ label: 'หัวข้อ', sortOrder: -1 }).success).toBe(false);
    expect(updateTicketRatingCriterionSchema.safeParse({}).success).toBe(false);
  });
});
