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
  appUrl: () => 'https://app.example.test',
  formatThaiDateTime: () => 'Test time',
}));

import {
  dispatchNotificationOutbox, dispatchLineNotificationOutbox, isValidLineNotificationPayload, isValidNotificationPayload, sendNotification,
} from '../src/services/notificationService';

beforeEach(() => vi.clearAllMocks());

function queuedDelivery(parentStatus: string, attemptCount = 0) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const payload = { recipientId: 'profile-1', type: 'test', title: 'Test', notificationId: 'notice-1', line: false, dependsOnOutboxId: 'parent', policy: { backoffSeconds: 30 } };
  mocks.from.mockImplementation((table: string) => {
    let operation = 'select'; let update: Record<string, unknown> = {}; let id = '';
    const result = () => ({ error: null, data: operation === 'update' ? (update.status === 'PROCESSING' ? { id: 'job' } : null)
      : id === 'parent' ? { status: parentStatus } : [{ id: 'job', payload, attempt_count: attemptCount, max_attempts: 3 }] });
    const query = {
      select: () => query, eq: (key: string, value: string) => { if (key === 'id') id = value; return query; },
      in: () => query, lt: () => query, or: () => query, order: () => query, limit: () => query,
      update: (value: Record<string, unknown>) => { operation = 'update'; update = value; updates.push(value); return query; },
      insert: (value: Record<string, unknown>) => { if (table === 'notifications') inserts.push(value); operation = 'insert'; return query; },
      maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  });
  return { updates, inserts };
}

it('cancels delayed escalation once the original delivery succeeds', async () => {
  const { updates, inserts } = queuedDelivery('COMPLETED');
  expect(await dispatchNotificationOutbox({} as Bindings)).toEqual({ completed: 1, failed: 0, dead: 0 });
  expect(inserts).toEqual([]);
  expect(updates).toContainEqual(expect.objectContaining({ status: 'CANCELLED', last_error: 'delivery resolved before escalation' }));
});

it('delivers unresolved escalation with a stable notification ID and no LINE fan-out', async () => {
  const { inserts } = queuedDelivery('DEAD');
  expect(await dispatchNotificationOutbox({} as Bindings)).toEqual({ completed: 1, failed: 0, dead: 0 });
  expect(inserts).toContainEqual(expect.objectContaining({ id: 'job', recipient_id: 'profile-1', send_line: false }));
});

it('uses snapshotted rule backoff and stops retrying at max attempts', async () => {
  const { updates } = queuedDelivery('ERROR', 1);
  mocks.resolveUserLineTarget.mockResolvedValue({ target: 'line-target', lineUserId: 'linked-user' });
  mocks.sendLinePush.mockResolvedValue({ success: false, error: 'temporary failure' });
  const now = new Date('2026-11-02T00:00:00Z');
  const result = await dispatchLineNotificationOutbox({ NOTIFY_LINE_ENABLED: 'true', LINE_CHANNEL_ACCESS_TOKEN: 'test-token' } as Bindings, now);
  expect(result).toEqual({ completed: 0, failed: 1, dead: 0 });
  expect(updates).toContainEqual(expect.objectContaining({ status: 'ERROR', next_attempt_at: '2026-11-02T00:01:00.000Z' }));
  const dead = queuedDelivery('ERROR', 2);
  expect(await dispatchLineNotificationOutbox({ NOTIFY_LINE_ENABLED: 'true', LINE_CHANNEL_ACCESS_TOKEN: 'test-token' } as Bindings, now)).toEqual({ completed: 0, failed: 1, dead: 1 });
  expect(dead.updates).toContainEqual(expect.objectContaining({ status: 'DEAD', next_attempt_at: null }));
});

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
