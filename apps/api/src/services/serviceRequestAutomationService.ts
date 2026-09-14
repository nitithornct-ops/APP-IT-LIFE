import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

export interface ServiceRequestAutomationResult {
  assigned: boolean;
  assigneeId: string | null;
  fulfillmentTaskId: string | null;
  reason: string | null;
}

export interface ServiceRequestSlaDispatchResult {
  warnings: number;
  breaches: number;
  escalations: number;
}

const EMPTY_AUTOMATION_RESULT: ServiceRequestAutomationResult = {
  assigned: false,
  assigneeId: null,
  fulfillmentTaskId: null,
  reason: null,
};

const EMPTY_SLA_RESULT: ServiceRequestSlaDispatchResult = { warnings: 0, breaches: 0, escalations: 0 };

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseServiceRequestAutomationResult(value: unknown): ServiceRequestAutomationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_AUTOMATION_RESULT;
  const result = value as Record<string, unknown>;
  return {
    assigned: result.assigned === true,
    assigneeId: stringOrNull(result.assigneeId),
    fulfillmentTaskId: stringOrNull(result.fulfillmentTaskId),
    reason: stringOrNull(result.reason),
  };
}

export function parseServiceRequestSlaDispatchResult(value: unknown): ServiceRequestSlaDispatchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_SLA_RESULT;
  const result = value as Record<string, unknown>;
  return {
    warnings: count(result.warnings),
    breaches: count(result.breaches),
    escalations: count(result.escalations),
  };
}

/** Runs the database-transactional assignment/task automation for one request. */
export async function automateServiceRequest(
  env: Bindings,
  requestId: string,
  actorId?: string | null,
): Promise<ServiceRequestAutomationResult> {
  const admin = createAdminClient(env);
  const { data, error } = await admin.rpc('auto_assign_service_request', {
    request_id_input: requestId,
    actor_id_input: actorId ?? null,
  });
  if (error) throw new Error(`service_request_automation_failed: ${error.message}`);
  return parseServiceRequestAutomationResult(data);
}

/** Retries queued assignments so a transient failure does not leave work stranded. */
export async function dispatchPendingServiceRequestAutomation(
  env: Bindings,
  _now = new Date(),
): Promise<{ attempted: number; assigned: number; tasksCreated: number }> {
  const admin = createAdminClient(env);
  const { data, error } = await admin
    .from('service_requests')
    .select('id, created_by, requester_id')
    .eq('status', 'รอมอบหมาย')
    .is('assignee_id', null)
    .not('assigned_group_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw new Error(`service_request_automation_queue_load_failed: ${error.message}`);

  const result = { attempted: 0, assigned: 0, tasksCreated: 0 };
  for (const request of data ?? []) {
    result.attempted += 1;
    const automation = await automateServiceRequest(env, request.id, request.created_by ?? request.requester_id);
    if (automation.assigned) result.assigned += 1;
    if (automation.fulfillmentTaskId) result.tasksCreated += 1;
  }
  return result;
}

/** Runs the database-transactional and idempotent SLA warning/breach dispatcher. */
export async function dispatchServiceRequestSlaEscalations(
  env: Bindings,
  now = new Date(),
): Promise<ServiceRequestSlaDispatchResult> {
  const admin = createAdminClient(env);
  const { data, error } = await admin.rpc('dispatch_service_request_sla_escalations', {
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`service_request_sla_dispatch_failed: ${error.message}`);
  return parseServiceRequestSlaDispatchResult(data);
}
