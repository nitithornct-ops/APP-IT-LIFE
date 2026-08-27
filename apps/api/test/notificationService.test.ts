import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/types';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => ({ from: mocks.from }) }));

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
});
