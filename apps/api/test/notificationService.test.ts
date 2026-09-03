import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/types';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  resolveUserLineTarget: vi.fn(),
  sendLinePush: vi.fn(),
  buildUserNotificationFlexMessage: vi.fn((input) => ({ type: 'flex', input })),
}));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock('../src/lib/lineMessaging', () => ({
  resolveUserLineTarget: mocks.resolveUserLineTarget,
  sendLinePush: mocks.sendLinePush,
  buildUserNotificationFlexMessage: mocks.buildUserNotificationFlexMessage,
}));

import {
  dispatchLineNotificationOutbox, isValidLineNotificationPayload, isValidNotificationPayload, sendNotification,
} from '../src/services/notificationService';

beforeEach(() => vi.clearAllMocks());

describe('notification payload validation', () => {
  it('accepts a complete notification payload', () => {
    expect(isValidNotificationPayload({ recipientId: 'profile-1', type: 'ticket_status_changed', title: 'Ticket updated' })).toBe(true);
  });

  it.each([
    null,
    {},
    { recipientId: null, type: 'ticket_status_changed', title: 'Ticket updated' },
    { recipientId: ' ', type: 'ticket_status_changed', title: 'Ticket updated' },
    { recipientId: 'profile-1', type: '', title: 'Ticket updated' },
    { recipientId: 'profile-1', type: 'ticket_status_changed', title: '' },
  ])('rejects an invalid payload without touching the database: %j', async (payload) => {
    expect(isValidNotificationPayload(payload)).toBe(false);
    await expect(sendNotification({} as Bindings, payload as never)).resolves.toBeUndefined();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects an invalid LINE delivery flag', () => {
    expect(isValidNotificationPayload({ recipientId: 'profile-1', type: 'task_due', title: 'Task due', line: 'yes' })).toBe(false);
  });

  it('validates trigger-created LINE outbox payloads', () => {
    expect(isValidLineNotificationPayload({
      notificationId: 'notification-1', recipientId: 'profile-1', type: 'task_due', title: 'Task due',
    })).toBe(true);
    expect(isValidLineNotificationPayload({
      recipientId: 'profile-1', type: 'task_due', title: 'Task due',
    })).toBe(false);
  });
});

describe('linked LINE companion notification', () => {
  it('marks a normal in-app notification for durable LINE fan-out', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert });
    await sendNotification({} as Bindings, {
      recipientId: 'profile-1', type: 'workflow_approval', title: 'รออนุมัติเอกสาร', body: 'เลขที่ WF-001', link: '/workflows',
    });

    expect(insert).toHaveBeenCalledWith({
      recipient_id: 'profile-1', type: 'workflow_approval', title: 'รออนุมัติเอกสาร',
      body: 'เลขที่ WF-001', link: '/workflows', send_line: true,
    });
    expect(mocks.sendLinePush).not.toHaveBeenCalled();
  });

  it('marks a richer caller-owned LINE event to prevent duplicate fan-out', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert });
    await sendNotification({} as Bindings, { recipientId: 'profile-1', type: 'ticket_status', title: 'Ticket updated', line: false });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ send_line: false }));
  });

  it('leaves queued LINE jobs untouched when messaging is disabled', async () => {
    await expect(dispatchLineNotificationOutbox({} as Bindings)).resolves.toEqual({ completed: 0, failed: 0, dead: 0 });

    expect(mocks.from).not.toHaveBeenCalled();
  });
});
