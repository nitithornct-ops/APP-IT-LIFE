import { describe, expect, it } from 'vitest';
import { getTicketReturnTo } from './ticketNavigation';

describe('ticket return navigation', () => {
  it('restores the original filters, sort and page', () => {
    const list = '/tickets?status=ใหม่&page=3&sort=due_at&order=asc';
    expect(getTicketReturnTo({ ticketReturnTo: list })).toBe(list);
  });

  it.each([null, {}, { ticketReturnTo: 1 }, { ticketReturnTo: '//example.com' }, { ticketReturnTo: '/tickets/other' }, { ticketReturnTo: 'https://example.com/tickets' }])('falls back to the list for invalid state %j', (state) => {
    expect(getTicketReturnTo(state)).toBe('/tickets');
  });
});
