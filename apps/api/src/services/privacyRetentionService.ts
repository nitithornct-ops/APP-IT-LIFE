import { createAdminClient } from '../lib/supabase';
import { ATTACHMENTS_BUCKET } from './storageService';
import { TICKET_SIGNATURE_BUCKET } from './ticketSignatureService';
import type { Bindings } from '../types';

const MAX_TICKETS_PER_RUN = 100;

export interface PrivacyRetentionResult {
  skipped: boolean;
  matched: number;
  ticketsAnonymized: number;
  attachmentMetadataDeleted: number;
  filesDeleted: number;
}
interface CandidateTicket {
  id: string;
  signature_storage_path: string | null;
  requester_signature_storage_path: string | null;
}

interface CandidateAttachment {
  id: string;
  storage_path: string;
}

function nonNegative(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

export function parsePrivacyRetentionApplyResult(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ticketsAnonymized: 0, attachmentMetadataDeleted: 0 };
  }
  const result = value as Record<string, unknown>;
  return {
    ticketsAnonymized: nonNegative(result.ticketsAnonymized),
    attachmentMetadataDeleted: nonNegative(result.attachmentMetadataDeleted),
  };
}

async function removePaths(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  paths: readonly string[],
): Promise<number> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) return 0;
  const { error } = await admin.storage.from(bucket).remove(uniquePaths);
  if (error) throw new Error(`privacy_retention_storage_failed:${bucket}:${error.message}`);
  return uniquePaths.length;
}

/**
 * Scheduled public-Ticket privacy retention. Storage is removed before the transactional
 * metadata/anonymization RPC; retries are safe when a prior run removed an object but failed
 * before committing database changes. Backup buckets and backup tables are never queried.
 */
export async function dispatchPrivacyRetention(
  env: Bindings,
  scheduledAt = new Date(),
): Promise<PrivacyRetentionResult> {
  const admin = createAdminClient(env);
  const { data: claim, error: claimError } = await admin.rpc('claim_automated_privacy_retention', {
    scheduled_at_input: scheduledAt.toISOString(),
  });
  if (claimError) throw new Error(`privacy_retention_claim_failed:${claimError.message}`);
  if (!claim || typeof claim !== 'object' || Array.isArray(claim) || typeof (claim as { id?: unknown }).id !== 'string') {
    return { skipped: true, matched: 0, ticketsAnonymized: 0, attachmentMetadataDeleted: 0, filesDeleted: 0 };
  }
  const runId = (claim as { id: string }).id;
  let matched = 0;
  let affected = 0;

  try {
    const { data: policy, error: policyError } = await admin
      .from('governance_retention_policies')
      .select('retention_days,terminal_statuses')
      .eq('policy_code', 'RET-PUBLIC-TICKET-730')
      .eq('status', 'ACTIVE')
      .maybeSingle();
    if (policyError || !policy) throw new Error(`privacy_retention_policy_unavailable:${policyError?.message ?? 'missing'}`);

    const retentionDays = Number(policy.retention_days);
    if (!Number.isInteger(retentionDays) || retentionDays < 30) throw new Error('privacy_retention_policy_invalid');
    const cutoff = new Date(scheduledAt.getTime() - retentionDays * 86_400_000);
    const terminalStatuses = Array.isArray(policy.terminal_statuses)
      ? policy.terminal_statuses.filter((status): status is string => typeof status === 'string' && status.length > 0)
      : [];
    if (terminalStatuses.length === 0) throw new Error('privacy_retention_terminal_statuses_missing');

    const { data: ticketRows, error: ticketsError } = await admin
      .from('tickets')
      .select('id,signature_storage_path,requester_signature_storage_path')
      .eq('source_channel', 'guest')
      .in('status', terminalStatuses)
      .lt('updated_at', cutoff.toISOString())
      .is('privacy_anonymized_at', null)
      .order('updated_at', { ascending: true })
      .limit(MAX_TICKETS_PER_RUN);
    if (ticketsError) throw new Error(`privacy_retention_candidates_failed:${ticketsError.message}`);
    const tickets = (ticketRows ?? []) as CandidateTicket[];
    matched = tickets.length;

    const ticketIds = tickets.map((ticket) => ticket.id);
    let attachments: CandidateAttachment[] = [];
    if (ticketIds.length > 0) {
      const { data, error } = await admin
        .from('file_attachments')
        .select('id,storage_path')
        .eq('module', 'ticket')
        .eq('target_table', 'tickets')
        .in('target_id', ticketIds);
      if (error) throw new Error(`privacy_retention_attachments_failed:${error.message}`);
      attachments = (data ?? []) as CandidateAttachment[];
    }

    const attachmentFilesDeleted = await removePaths(admin, ATTACHMENTS_BUCKET, attachments.map((file) => file.storage_path));
    const signatureFilesDeleted = await removePaths(admin, TICKET_SIGNATURE_BUCKET, tickets.flatMap((ticket) => [
      ticket.signature_storage_path,
      ticket.requester_signature_storage_path,
    ].filter((path): path is string => Boolean(path))));

    const { data: applied, error: applyError } = await admin.rpc('apply_public_ticket_privacy_retention', {
      ticket_ids_input: ticketIds,
      attachment_ids_input: attachments.map((attachment) => attachment.id),
      cutoff_input: cutoff.toISOString(),
      applied_at_input: scheduledAt.toISOString(),
    });
    if (applyError) throw new Error(`privacy_retention_apply_failed:${applyError.message}`);
    const counts = parsePrivacyRetentionApplyResult(applied);
    affected = counts.ticketsAnonymized + counts.attachmentMetadataDeleted;
    const filesDeleted = attachmentFilesDeleted + signatureFilesDeleted;

    const { error: completeError } = await admin.rpc('complete_automated_privacy_retention', {
      run_id_input: runId,
      status_input: 'COMPLETED',
      matched_input: matched,
      affected_input: affected,
      detail_input: {
        ticketsAnonymized: counts.ticketsAnonymized,
        attachmentMetadataDeleted: counts.attachmentMetadataDeleted,
        filesDeleted,
        retentionDays,
        backupExcluded: true,
      },
      completed_at_input: new Date().toISOString(),
    });
    if (completeError) throw new Error(`privacy_retention_complete_failed:${completeError.message}`);

    return { skipped: false, matched, ...counts, filesDeleted };
  } catch (error) {
    await admin.rpc('complete_automated_privacy_retention', {
      run_id_input: runId,
      status_input: 'FAILED',
      matched_input: matched,
      affected_input: affected,
      detail_input: { error: error instanceof Error ? error.message.slice(0, 500) : 'unknown error', backupExcluded: true },
      completed_at_input: new Date().toISOString(),
    });
    throw error;
  }
}
