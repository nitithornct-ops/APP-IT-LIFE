import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/types';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => ({ from: mocks.from }) }));

import { resolveTicketRequesterLineTarget, sendLinePush } from '../src/lib/lineMessaging';

const env = {} as Bindings;

function mockLineRow(row: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row });
  const builder = { eq: vi.fn(() => builder), maybeSingle };
  const select = vi.fn(() => builder);
  mocks.from.mockReturnValue({ select });
  return { builder, select };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveTicketRequesterLineTarget', () => {
  it('uses the direct LINE identity for a LINE-created ticket', async () => {
    const { builder } = mockLineRow({ id: 'line-row-1', line_user_id: 'U123', linked_user_id: 'profile-1', link_status: 'Active' });
    await expect(resolveTicketRequesterLineTarget(env, 'line-row-1', 'profile-1')).resolves.toEqual({
      target: 'U123', lineUserId: 'line-row-1', linkedUserId: 'profile-1',
    });
    expect(builder.eq).toHaveBeenCalledWith('id', 'line-row-1');
  });

  it('finds the linked LINE identity for a web-created ticket', async () => {
    const { builder } = mockLineRow({ id: 'line-row-2', line_user_id: 'U456', linked_user_id: 'profile-2', link_status: 'Active' });
    await expect(resolveTicketRequesterLineTarget(env, null, 'profile-2')).resolves.toEqual({
      target: 'U456', lineUserId: 'line-row-2', linkedUserId: 'profile-2',
    });
    expect(builder.eq).toHaveBeenCalledWith('linked_user_id', 'profile-2');
  });

  it('does not target a suspended LINE identity', async () => {
    mockLineRow({ id: 'line-row-3', line_user_id: 'U789', linked_user_id: 'profile-3', link_status: 'Suspended' });
    await expect(resolveTicketRequesterLineTarget(env, null, 'profile-3')).resolves.toBeNull();
  });
});

describe('sendLinePush', () => {
  const enabledEnv = { NOTIFY_LINE_ENABLED: 'true', LINE_CHANNEL_ACCESS_TOKEN: 'test-token' } as Bindings;

  function mockNotificationLog() {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert });
    return insert;
  }

  it('returns a successful delivery result and writes the delivery log', async () => {
    const insert = mockNotificationLog();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn() });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendLinePush(enabledEnv, 'U123', 'test message', 'line-row-1')).resolves.toEqual({ success: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v2/bot/message/push'), expect.objectContaining({ method: 'POST' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ line_user_id: 'line-row-1', success: true }));
  });

  it('returns the LINE API failure and writes a failed delivery log', async () => {
    const insert = mockNotificationLog();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: vi.fn().mockResolvedValue('invalid target') }));

    const result = await sendLinePush(enabledEnv, 'U123', 'test message', 'line-row-1');
    expect(result).toEqual({ success: false, error: 'HTTP 400: invalid target' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'HTTP 400: invalid target' }));
  });

  it('does not call LINE when messaging is disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendLinePush({} as Bindings, 'U123', 'test message')).resolves.toEqual({
      success: false,
      error: 'LINE Messaging is disabled or incomplete',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
