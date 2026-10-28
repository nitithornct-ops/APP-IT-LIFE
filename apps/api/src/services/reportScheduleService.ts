import { createAdminClient } from '../lib/supabase';
import { generateScheduledSnapshot, nextScheduleAt } from '../routes/reports';
import type { Bindings } from '../types';

interface DueSchedule {
  id: string;
  report_key: string;
  filters: unknown;
  frequency: 'weekly' | 'monthly';
  day_of_week: number | null;
  day_of_month: number | null;
  run_hour: number;
  timezone: string;
  created_by: string;
  next_run_at: string;
  format: 'CSV' | 'PDF' | 'PRINT';
  save_to_drive: boolean;
}

/**
 * Cron entrypoint for governed report generation. The unique schedule slot on
 * report_schedule_runs makes overlapping cron invocations idempotent.
 */
export async function dispatchScheduledReports(env: Bindings, now = new Date()): Promise<{ processed: number; succeeded: number; failed: number }> {
  const admin = createAdminClient(env);
  const { data, error } = await admin
    .from('report_schedules')
    .select('id,report_key,filters,frequency,day_of_week,day_of_month,run_hour,timezone,created_by,next_run_at,format,save_to_drive')
    .eq('enabled', true)
    .lte('next_run_at', now.toISOString())
    .order('next_run_at')
    .limit(25);
  if (error) throw new Error(error.message);

  let succeeded = 0;
  let failed = 0;
  for (const schedule of (data ?? []) as unknown as DueSchedule[]) {
    const scheduledFor = schedule.next_run_at;
    const nextRunAt = nextScheduleAt({ frequency: schedule.frequency, dayOfWeek: schedule.day_of_week ?? undefined, dayOfMonth: schedule.day_of_month ?? undefined, runHour: schedule.run_hour, timezone: schedule.timezone }, now);
    const advanceSchedule = async () => admin.from('report_schedules')
      .update({ last_run_at: now.toISOString(), next_run_at: nextRunAt })
      .eq('id', schedule.id).eq('next_run_at', scheduledFor);
    const token = crypto.randomUUID();
    const leaseUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
    const claim = await admin.from('report_schedule_runs').insert({
      schedule_id: schedule.id,
      scheduled_for: scheduledFor,
      status: 'running',
      started_at: now.toISOString(),
      claim_token: token,
      lease_until: leaseUntil,
      recovery_phase: 'preparing',
    }).select('id').maybeSingle();
    let runId = String(claim.data?.id ?? '');
    if (claim.error) {
      if (claim.error.code === '23505') {
        // A completed run may have been recorded before the schedule update failed.
        // Do not regenerate it: just retry the compare-and-set schedule update.
        const existing = await admin.from('report_schedule_runs').select('id,status,started_at,claim_token,lease_until,recovery_phase')
          .eq('schedule_id', schedule.id).eq('scheduled_for', scheduledFor).maybeSingle();
        if (existing.error || !existing.data) { failed += 1; continue; }
        if (existing.data?.status === 'succeeded' || existing.data?.status === 'failed') {
          const advanced = await advanceSchedule();
          if (advanced.error || existing.data.status === 'failed') failed += 1;
          else succeeded += 1;
          continue;
        } else if (existing.data.status === 'running') {
          const staleLease = existing.data.lease_until && new Date(existing.data.lease_until).getTime() <= now.getTime();
          if (staleLease && existing.data.claim_token && ['preparing', 'snapshot_ready'].includes(existing.data.recovery_phase)) {
            const reclaimed = await admin.from('report_schedule_runs')
              .update({ claim_token: token, lease_until: leaseUntil, started_at: now.toISOString() })
              .eq('id', existing.data.id).eq('status', 'running').eq('claim_token', existing.data.claim_token)
              .eq('recovery_phase', existing.data.recovery_phase).lte('lease_until', now.toISOString()).select('id').maybeSingle();
            if (reclaimed.error) { failed += 1; continue; }
            if (!reclaimed.data) continue; // Another worker won the lease.
            runId = String(reclaimed.data.id);
          } else {
            const legacyStale = !existing.data.lease_until && existing.data.started_at
              && new Date(existing.data.started_at).getTime() < now.getTime() - 30 * 60_000;
            if (staleLease || legacyStale) {
              console.error(JSON.stringify({ msg: 'report_schedule_run_stale', runId: existing.data.id, scheduleId: schedule.id, scheduledFor, phase: existing.data.recovery_phase ?? 'legacy_unknown' }));
              failed += 1;
            }
            continue;
          }
        } else {
          failed += 1;
          continue;
        }
      } else { failed += 1; continue; }
    }
    if (!runId) { failed += 1; continue; }
    let runUpdate: Record<string, unknown>;
    let runSucceeded = false;
    try {
      const snapshot = await generateScheduledSnapshot(env, schedule, now, { runId, token });
      const artifact = snapshot.artifact;
      runSucceeded = !artifact.error;
      runUpdate = { status: runSucceeded ? 'succeeded' : 'failed', snapshot_id: snapshot.id, artifact_name: artifact.name, artifact_drive_id: artifact.driveId, artifact_drive_url: artifact.driveUrl, artifact_error: artifact.error, error_message: artifact.error, finished_at: now.toISOString() };
    } catch (error) {
      if (error instanceof Error && error.name === 'ScheduledReportClaimUncertainError') { failed += 1; continue; }
      const message = error instanceof Error ? error.message : String(error);
      runUpdate = { status: 'failed', error_message: message.slice(0, 1000), finished_at: now.toISOString() };
    }
    const finalized = await admin.from('report_schedule_runs').update(runUpdate).eq('id', runId).eq('status', 'running').eq('claim_token', token).select('id').maybeSingle();
    if (finalized.error || !finalized.data) { failed += 1; continue; }
    const advanced = await advanceSchedule();
    if (advanced.error || !runSucceeded) failed += 1;
    else succeeded += 1;
  }
  return { processed: succeeded + failed, succeeded, failed };
}
