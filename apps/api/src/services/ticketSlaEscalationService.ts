import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

export interface TicketSlaDispatchResult {
  warnings: number;
  breaches: number;
  escalations: number;
}
const EMPTY_RESULT: TicketSlaDispatchResult = { warnings: 0, breaches: 0, escalations: 0 };

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseTicketSlaDispatchResult(value: unknown): TicketSlaDispatchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_RESULT;
  const result = value as Record<string, unknown>;
  return {
    warnings: count(result.warnings),
    breaches: count(result.breaches),
    escalations: count(result.escalations),
  };
}

/** Runs the database-transactional and idempotent SLA dispatcher. */
export async function dispatchTicketSlaEscalations(
  env: Bindings,
  now = new Date(),
): Promise<TicketSlaDispatchResult> {
  const supabase = createAdminClient(env);
  const { data, error } = await supabase.rpc('dispatch_ticket_sla_escalations', {
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`ticket_sla_dispatch_failed: ${error.message}`);
  return parseTicketSlaDispatchResult(data);
}
