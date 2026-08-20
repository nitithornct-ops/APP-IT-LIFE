import { describe, expect, it } from 'vitest';
import { calculateTicketOverallRating, ticketRatingDetailsSchema } from './rating';

describe('ticket service rating', () => {
  it('accepts 1–20 dynamic criteria at levels 1 to 5', () => {
    const valid = { responsiveness: 5, workQuality: 4, serviceManners: 5, expertise: 4, communication: 3 };
    expect(ticketRatingDetailsSchema.safeParse(valid).success).toBe(true);
    expect(ticketRatingDetailsSchema.safeParse({ ...valid, expertise: 6 }).success).toBe(false);
    expect(ticketRatingDetailsSchema.safeParse({ responsiveness: 5 }).success).toBe(true);
    expect(ticketRatingDetailsSchema.safeParse({}).success).toBe(false);
  });

  it('rounds the dynamic average for the legacy overall CSAT field', () => {
    expect(calculateTicketOverallRating({ responsiveness: 5, workQuality: 4, serviceManners: 5, expertise: 4, communication: 3 })).toBe(4);
    expect(calculateTicketOverallRating({ responsiveness: 5, workQuality: 5, serviceManners: 5, expertise: 5, communication: 5 })).toBe(5);
  });
});
