import app from './index';
import { dispatchIntegrationRetention } from './services/integrationRetentionService';
import { dispatchLineNotificationOutbox, dispatchNotificationOutbox } from './services/notificationService';
import { dispatchPrivacyRetention } from './services/privacyRetentionService';
import { dispatchDueTaskReminders } from './services/taskReminderService';
import { dispatchDueAssetLoanReminders } from './services/assetLoanReminderService';
import { dispatchPendingServiceRequestAutomation, dispatchServiceRequestSlaEscalations } from './services/serviceRequestAutomationService';
import { dispatchTicketSlaEscalations } from './services/ticketSlaEscalationService';
import { dispatchAccessExpiry } from './services/accessExpiryService';
import { collectSystemStatusChecks, recordSystemStatusChecks } from './services/systemStatusService';
import { dispatchBackupMonitoring } from './services/backupMonitoringService';
import { dispatchScheduledReports } from './services/reportScheduleService';
import type { Bindings } from './types';

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    const startedAt = Date.now();
    const result: Record<string, unknown> = {};
    const failedJobs: string[] = [];
    const runJobs = async (jobs: Array<[string, () => Promise<unknown>]>) => {
      const settled = await Promise.allSettled(jobs.map(([, run]) => Promise.resolve().then(run)));
      settled.forEach((job, index) => {
        const name = jobs[index][0];
        if (job.status === 'fulfilled') {
          result[name] = job.value;
          const reportedFailures = name === 'scheduledReports' && job.value !== null && typeof job.value === 'object'
            && 'failed' in job.value && typeof job.value.failed === 'number' && job.value.failed > 0;
          if (reportedFailures) {
            failedJobs.push(name);
            console.error(JSON.stringify({ msg: 'scheduled_job_failed', job: name, reason: 'reported_failures' }));
          } else {
            console.info(JSON.stringify({ msg: 'scheduled_job_complete', job: name }));
          }
        } else {
          failedJobs.push(name);
          console.error(JSON.stringify({ msg: 'scheduled_job_failed', job: name }));
        }
      });
    };
    await runJobs([
      ['taskRemindersDelivered', () => dispatchDueTaskReminders(env, scheduledAt)],
      ['assetLoanRemindersDelivered', () => dispatchDueAssetLoanReminders(env, scheduledAt)],
      ['ticketSla', () => dispatchTicketSlaEscalations(env, scheduledAt)],
      ['serviceRequestSla', () => dispatchServiceRequestSlaEscalations(env, scheduledAt)],
      ['serviceRequestAutomation', () => dispatchPendingServiceRequestAutomation(env, scheduledAt)],
      ['privacyRetention', () => dispatchPrivacyRetention(env, scheduledAt)],
      ['integrationRetention', () => dispatchIntegrationRetention(env, scheduledAt)],
      ['accessExpiry', () => dispatchAccessExpiry(env, scheduledAt)],
      ['backupMonitoring', () => dispatchBackupMonitoring(env, scheduledAt)],
      ['scheduledReports', () => dispatchScheduledReports(env, scheduledAt)],
    ]);
    // Wait for every producer, even when one fails, before draining each outbox independently.
    await runJobs([
      ['notifications', () => dispatchNotificationOutbox(env, scheduledAt)],
      ['lineNotifications', () => dispatchLineNotificationOutbox(env, scheduledAt)],
    ]);

    const statusChecks = await collectSystemStatusChecks(env, {
      now: scheduledAt,
      scheduledJobs: {
        status: failedJobs.length ? 'down' : 'operational',
        responseTimeMs: Date.now() - startedAt,
        failureReason: failedJobs.length ? 'job_failed' : null,
      },
    });
    await recordSystemStatusChecks(env, statusChecks, 'scheduled');
    console.info(JSON.stringify({
      msg: 'scheduled_dispatch_complete',
      ...result,
      failedJobs,
      statusChecksRecorded: statusChecks.length,
      scheduledTime: controller.scheduledTime,
    }));
    if (failedJobs.length) throw new Error(`Scheduled jobs failed: ${failedJobs.join(', ')}`);
  },
} satisfies ExportedHandler<Bindings>;
