import { describe, expect, it } from 'vitest';
import type { TicketDetail, TicketWorklog } from '../../types/tickets';
import { conversationAuthor, conversationSide, isConversationEntry } from './ticketConversation';

function makeLog(overrides: Partial<TicketWorklog> = {}): TicketWorklog {
  return {
    id: 'log-1',
    ticket_id: 'ticket-1',
    action: 'ข้อความสนทนา',
    detail: 'ทดสอบ',
    status_from: null,
    status_to: null,
    minutes_spent: null,
    is_public: true,
    entry_type: 'comment',
    actor_id: null,
    actor_line_user_id: null,
    actor_label: null,
    actor: null,
    created_at: '2026-09-01T03:00:00.000Z',
    ...overrides,
  };
}

const ticket = {
  requester_id: 'requester-1',
  assignee_id: 'tech-1',
  requester: { full_name: 'สมชาย ใจดี', email: 'somchai@example.com' },
  requester_name_snapshot: 'สมชาย ใจดี',
  guest_name: null,
} as TicketDetail;

describe('ticket conversation entries', () => {
  it('counts only chat entries as conversation, leaving work events on the timeline', () => {
    expect(isConversationEntry(makeLog({ entry_type: 'comment' }))).toBe(true);
    expect(isConversationEntry(makeLog({ entry_type: 'internal_note' }))).toBe(true);
    expect(isConversationEntry(makeLog({ entry_type: 'timeline' }))).toBe(false);
    expect(isConversationEntry(makeLog({ entry_type: 'worklog' }))).toBe(false);
  });
});

describe('conversation speaker side', () => {
  it('reads a LINE-portal message as the requester even without a linked account', () => {
    expect(conversationSide(makeLog({ actor_line_user_id: 'line-1' }), 'requester-1')).toBe('requester');
  });

  it('reads a guest message with no account at all as the requester', () => {
    expect(conversationSide(makeLog({ actor_id: null, actor_label: 'ผู้แจ้งผ่านหน้าสาธารณะ: สมชาย' }), 'requester-1')).toBe('requester');
  });

  it('separates the requester writing from the web app from the technician answering', () => {
    expect(conversationSide(makeLog({ actor_id: 'requester-1' }), 'requester-1')).toBe('requester');
    expect(conversationSide(makeLog({ actor_id: 'tech-1' }), 'requester-1')).toBe('staff');
  });
});

describe('conversation author label', () => {
  it('names the viewer own messages instead of repeating their name back to them', () => {
    expect(conversationAuthor(makeLog({ actor_id: 'tech-1' }), ticket, 'tech-1')).toBe('คุณ');
  });

  it('marks the assignee as the technician working the ticket and other staff as the IT team', () => {
    expect(conversationAuthor(makeLog({ actor_id: 'tech-1', actor: { full_name: 'ช่างเอ', email: 'a@example.com' } }), ticket, 'requester-1'))
      .toBe('ช่างเอ · ช่างผู้ดำเนินการ');
    expect(conversationAuthor(makeLog({ actor_id: 'tech-2', actor: { full_name: 'หัวหน้าบี', email: 'b@example.com' } }), ticket, 'requester-1'))
      .toBe('หัวหน้าบี · ทีม IT');
  });

  it('falls back to the ticket requester name for a guest message that carries no actor', () => {
    const guestTicket = { ...ticket, requester: null, requester_name_snapshot: null, guest_name: 'สมหญิง รักงาน' } as TicketDetail;
    expect(conversationAuthor(makeLog(), guestTicket, 'tech-1')).toBe('สมหญิง รักงาน · ผู้แจ้ง');
  });
});
