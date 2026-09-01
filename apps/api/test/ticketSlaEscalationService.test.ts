import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/types';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import {
  dispatchTicketSlaEscalations,
  parseTicketSlaDispatchResult,
} from '../src/services/ticketSlaEscalationService';

beforeEach(() => vi.clearAllMocks());

describe('ticket SLA escalation service', () => {
  it('normalizes the RPC result', () => {
    expect(parseTicketSlaDispatchResult({ warnings: 2, breaches: '3', escalations: 1 })).toEqual({
      warnings: 2,
      breaches: 3,
      escalations: 1,
    });
    expect(parseTicketSlaDispatchResult(null)).toEqual({ warnings: 0, breaches: 0, escalations: 0 });
  });

  it('calls the transactional dispatcher with the scheduled instant', async () => {
    mocks.rpc.mockResolvedValue({ data: { warnings: 1, breaches: 1, escalations: 1 }, error: null });
    const now = new Date('2026-08-31T03:00:00.000Z');

    await expect(dispatchTicketSlaEscalations({} as Bindings, now)).resolves.toEqual({
      warnings: 1,
      breaches: 1,
      escalations: 1,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('dispatch_ticket_sla_escalations', {
      p_now: now.toISOString(),
    });
  });

  it('fails the cron run when the database dispatcher fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(dispatchTicketSlaEscalations({} as Bindings)).rejects.toThrow(
      'ticket_sla_dispatch_failed: offline',
    );
  });
});
