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
    const claim = await admin.from('report_schedule_runs').insert({
      schedule_id: schedule.id,
      scheduled_for: scheduledFor,
      status: 'running',
      started_at: now.toISOString(),
    }).select('id').maybeSingle();
    if (claim.error) {
      // 23505 means another Worker invocation claimed this exact slot.
      if (claim.error.code === '23505') continue;
      failed += 1;
      continue;
    }
    const runId = String(claim.data?.id ?? '');
    try {
      const nextRunAt = nextScheduleAt({ frequency: schedule.frequency, dayOfWeek: schedule.day_of_week ?? undefined, dayOfMonth: schedule.day_of_month ?? undefined, runHour: schedule.run_hour, timezone: schedule.timezone }, now);
      const snapshot = await generateScheduledSnapshot(env, schedule, now);
      const artifact = snapshot.artifact;
      if (artifact.error) {
        await admin.from('report_schedule_runs').update({ status: 'failed', snapshot_id: snapshot.id, artifact_name: artifact.name, artifact_drive_id: artifact.driveId, artifact_drive_url: artifact.driveUrl, artifact_error: artifact.error, error_message: artifact.error, finished_at: now.toISOString() }).eq('id', runId);
        await admin.from('report_schedules').update({ last_run_at: now.toISOString(), next_run_at: nextRunAt }).eq('id', schedule.id).eq('next_run_at', scheduledFor);
        failed += 1;
        continue;
      }
      await admin.from('report_schedule_runs').update({ status: 'succeeded', snapshot_id: snapshot.id, artifact_name: artifact.name, artifact_drive_id: artifact.driveId, artifact_drive_url: artifact.driveUrl, finished_at: now.toISOString() }).eq('id', runId);
      await admin.from('report_schedules').update({ last_run_at: now.toISOString(), next_run_at: nextRunAt }).eq('id', schedule.id).eq('next_run_at', scheduledFor);
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin.from('report_schedule_runs').update({ status: 'failed', error_message: message.slice(0, 1000), finished_at: now.toISOString() }).eq('id', runId);
      const nextRunAt = nextScheduleAt({ frequency: schedule.frequency, dayOfWeek: schedule.day_of_week ?? undefined, dayOfMonth: schedule.day_of_month ?? undefined, runHour: schedule.run_hour, timezone: schedule.timezone }, now);
      await admin.from('report_schedules').update({ last_run_at: now.toISOString(), next_run_at: nextRunAt }).eq('id', schedule.id).eq('next_run_at', scheduledFor);
      failed += 1;
    }
  }
  return { processed: succeeded + failed, succeeded, failed };
}
