import { describe, expect, it } from 'vitest';
import { generateTrackingCode } from '../src/routes/publicTickets';

describe('public Ticket tracking code', () => {
  it('generates a short readable code with enough random combinations', () => {
    const codes = Array.from({ length: 100 }, () => generateTrackingCode());
    expect(new Set(codes).size).toBe(100);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
  });
});
