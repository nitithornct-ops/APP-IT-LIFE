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

import { isValidNotificationPayload, sendNotification } from '../src/services/notificationService';

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
});

describe('linked LINE companion notification', () => {
  const env = {
    NOTIFY_LINE_ENABLED: 'true', LINE_CHANNEL_ACCESS_TOKEN: 'test-token', PUBLIC_APP_URL: 'https://life.example/base',
  } as Bindings;

  beforeEach(() => {
    mocks.from.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) });
    mocks.resolveUserLineTarget.mockResolvedValue({ target: 'U123', lineUserId: 'line-row-1' });
    mocks.sendLinePush.mockResolvedValue({ success: true, error: null });
  });

  it('delivers a successful in-app notification to the linked Active LINE account too', async () => {
    await sendNotification(env, {
      recipientId: 'profile-1', type: 'workflow_approval', title: 'รออนุมัติเอกสาร', body: 'เลขที่ WF-001', link: '/workflows',
    });

    expect(mocks.resolveUserLineTarget).toHaveBeenCalledWith(env, 'profile-1');
    expect(mocks.buildUserNotificationFlexMessage).toHaveBeenCalledWith({
      title: 'รออนุมัติเอกสาร', body: 'เลขที่ WF-001', url: 'https://life.example/workflows',
    });
    expect(mocks.sendLinePush).toHaveBeenCalledWith(
      env, 'U123', 'รออนุมัติเอกสาร\nเลขที่ WF-001', 'line-row-1', expect.objectContaining({ type: 'flex' }),
    );
  });

  it('skips LINE when the caller already owns a richer delivery for the event', async () => {
    await sendNotification(env, { recipientId: 'profile-1', type: 'ticket_status', title: 'Ticket updated', line: false });

    expect(mocks.resolveUserLineTarget).not.toHaveBeenCalled();
    expect(mocks.sendLinePush).not.toHaveBeenCalled();
  });

  it('keeps in-app delivery working when LINE messaging is disabled', async () => {
    await sendNotification({} as Bindings, { recipientId: 'profile-1', type: 'task_due', title: 'Task due' });

    expect(mocks.from).toHaveBeenCalledWith('notifications');
    expect(mocks.resolveUserLineTarget).not.toHaveBeenCalled();
  });
});
