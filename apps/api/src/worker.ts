import app from './index';
import { dispatchDueTaskReminders } from './services/taskReminderService';
import type { Bindings } from './types';

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const delivered = await dispatchDueTaskReminders(env, new Date(controller.scheduledTime));
    console.info(JSON.stringify({ msg: 'task_reminder_dispatch_complete', delivered, scheduledTime: controller.scheduledTime }));
  },
} satisfies ExportedHandler<Bindings>;
