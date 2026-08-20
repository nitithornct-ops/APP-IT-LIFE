import type { TicketDetail } from '../../types/tickets';

export function canSubmitTicketFeedback(
  ticket: Pick<TicketDetail, 'requester_id' | 'status' | 'rating'>,
  currentUserId: string | undefined,
): boolean {
  return ticket.requester_id === currentUserId && ticket.status === 'ปิดงาน' && ticket.rating === null;
}
