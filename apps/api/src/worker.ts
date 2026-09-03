import app from './index';
import { dispatchLineNotificationOutbox, dispatchNotificationOutbox } from './services/notificationService';
import { dispatchPrivacyRetention } from './services/privacyRetentionService';
import { dispatchDueTaskReminders } from './services/taskReminderService';
import { dispatchTicketSlaEscalations } from './services/ticketSlaEscalationService';
import type { Bindings } from './types';

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    const [delivered, ticketSla, privacyRetention] = await Promise.all([
      dispatchDueTaskReminders(env, scheduledAt),
      dispatchTicketSlaEscalations(env, scheduledAt),
      dispatchPrivacyRetention(env, scheduledAt),
    ]);
    // Reminder/SLA RPCs insert notifications transactionally. Dispatch both outboxes only after
    // those producers finish so their in-app and LINE jobs can be delivered in this cron run.
    const [notifications, lineNotifications] = await Promise.all([
      dispatchNotificationOutbox(env, scheduledAt),
      dispatchLineNotificationOutbox(env, scheduledAt),
    ]);
    console.info(JSON.stringify({
      msg: 'scheduled_dispatch_complete',
      taskRemindersDelivered: delivered,
      notifications,
      lineNotifications,
      ticketSla,
      privacyRetention,
      scheduledTime: controller.scheduledTime,
    }));
  },
} satisfies ExportedHandler<Bindings>;
