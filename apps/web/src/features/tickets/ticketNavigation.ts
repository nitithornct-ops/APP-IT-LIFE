/** Only restore the ticket list, never an arbitrary destination from route state. */
export function getTicketReturnTo(state: unknown): string {
  if (!state || typeof state !== 'object' || !('ticketReturnTo' in state)) return '/tickets';
  const value = state.ticketReturnTo;
  return typeof value === 'string' && (value === '/tickets' || value.startsWith('/tickets?'))
    ? value
    : '/tickets';
}
