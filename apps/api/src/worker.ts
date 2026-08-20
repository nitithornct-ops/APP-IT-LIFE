import app from './index';
import { dispatchNotificationOutbox } from './services/notificationService';
import { dispatchDueTaskReminders } from './services/taskReminderService';
import type { Bindings } from './types';

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    const [delivered, notifications] = await Promise.all([
      dispatchDueTaskReminders(env, scheduledAt),
      dispatchNotificationOutbox(env, scheduledAt),
    ]);
    console.info(JSON.stringify({
      msg: 'scheduled_dispatch_complete',
      taskRemindersDelivered: delivered,
      notifications,
      scheduledTime: controller.scheduledTime,
    }));
  },
} satisfies ExportedHandler<Bindings>;
