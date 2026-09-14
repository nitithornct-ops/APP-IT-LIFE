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
    let scheduledError: unknown = null;
    let result: Record<string, unknown> = {};
    try {
      const [delivered, assetLoanReminders, ticketSla, serviceRequestSla, serviceRequestAutomation, privacyRetention, integrationRetention, accessExpiry, backupMonitoring, scheduledReports] = await Promise.all([
        dispatchDueTaskReminders(env, scheduledAt),
        dispatchDueAssetLoanReminders(env, scheduledAt),
        dispatchTicketSlaEscalations(env, scheduledAt),
        dispatchServiceRequestSlaEscalations(env, scheduledAt),
        dispatchPendingServiceRequestAutomation(env, scheduledAt),
        dispatchPrivacyRetention(env, scheduledAt),
        dispatchIntegrationRetention(env, scheduledAt),
        dispatchAccessExpiry(env, scheduledAt),
        dispatchBackupMonitoring(env, scheduledAt),
        dispatchScheduledReports(env, scheduledAt),
      ]);
      // Reminder/SLA RPCs insert notifications transactionally. Dispatch both outboxes only after
      // those producers finish so their in-app and LINE jobs can be delivered in this cron run.
      const [notifications, lineNotifications] = await Promise.all([
        dispatchNotificationOutbox(env, scheduledAt),
        dispatchLineNotificationOutbox(env, scheduledAt),
      ]);
      result = {
        taskRemindersDelivered: delivered,
        assetLoanRemindersDelivered: assetLoanReminders,
        notifications,
        lineNotifications,
        ticketSla,
        serviceRequestSla,
        serviceRequestAutomation,
        privacyRetention,
        integrationRetention,
        accessExpiry,
        backupMonitoring,
        scheduledReports,
      };
    } catch (error) {
      scheduledError = error;
      console.error(JSON.stringify({ msg: 'scheduled_dispatch_failed' }));
    }

    const statusChecks = await collectSystemStatusChecks(env, {
      now: scheduledAt,
      scheduledJobs: {
        status: scheduledError ? 'down' : 'operational',
        responseTimeMs: Date.now() - startedAt,
        failureReason: scheduledError ? 'job_failed' : null,
      },
    });
    await recordSystemStatusChecks(env, statusChecks, 'scheduled');
    console.info(JSON.stringify({
      msg: 'scheduled_dispatch_complete',
      ...result,
      statusChecksRecorded: statusChecks.length,
      scheduledTime: controller.scheduledTime,
    }));
    if (scheduledError) throw scheduledError;
  },
} satisfies ExportedHandler<Bindings>;
