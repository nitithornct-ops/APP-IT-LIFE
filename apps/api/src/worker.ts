import app from './index';
import { dispatchNotificationOutbox } from './services/notificationService';
import { dispatchPrivacyRetention } from './services/privacyRetentionService';
import { dispatchDueTaskReminders } from './services/taskReminderService';
import { dispatchTicketSlaEscalations } from './services/ticketSlaEscalationService';
import type { Bindings } from './types';

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    const [delivered, notifications, ticketSla, privacyRetention] = await Promise.all([
      dispatchDueTaskReminders(env, scheduledAt),
      dispatchNotificationOutbox(env, scheduledAt),
      dispatchTicketSlaEscalations(env, scheduledAt),
      dispatchPrivacyRetention(env, scheduledAt),
    ]);
    console.info(JSON.stringify({
      msg: 'scheduled_dispatch_complete',
      taskRemindersDelivered: delivered,
      notifications,
      ticketSla,
      privacyRetention,
      scheduledTime: controller.scheduledTime,
    }));
  },
} satisfies ExportedHandler<Bindings>;
