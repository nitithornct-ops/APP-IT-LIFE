import { beforeEach, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/types';

const jobs = vi.hoisted(() => ({
  task: vi.fn(), loan: vi.fn(), ticket: vi.fn(), serviceSla: vi.fn(), serviceAutomation: vi.fn(),
  privacy: vi.fn(), retention: vi.fn(), access: vi.fn(), backup: vi.fn(), reports: vi.fn(),
  notifications: vi.fn(), line: vi.fn(), collect: vi.fn(), record: vi.fn(),
}));
vi.mock('../src/index', () => ({ default: { fetch: vi.fn() } }));
vi.mock('../src/services/taskReminderService', () => ({ dispatchDueTaskReminders: jobs.task }));
vi.mock('../src/services/assetLoanReminderService', () => ({ dispatchDueAssetLoanReminders: jobs.loan }));
vi.mock('../src/services/ticketSlaEscalationService', () => ({ dispatchTicketSlaEscalations: jobs.ticket }));
vi.mock('../src/services/serviceRequestAutomationService', () => ({ dispatchServiceRequestSlaEscalations: jobs.serviceSla, dispatchPendingServiceRequestAutomation: jobs.serviceAutomation }));
vi.mock('../src/services/privacyRetentionService', () => ({ dispatchPrivacyRetention: jobs.privacy }));
vi.mock('../src/services/integrationRetentionService', () => ({ dispatchIntegrationRetention: jobs.retention }));
vi.mock('../src/services/accessExpiryService', () => ({ dispatchAccessExpiry: jobs.access }));
vi.mock('../src/services/backupMonitoringService', () => ({ dispatchBackupMonitoring: jobs.backup }));
vi.mock('../src/services/reportScheduleService', () => ({ dispatchScheduledReports: jobs.reports }));
vi.mock('../src/services/notificationService', () => ({ dispatchNotificationOutbox: jobs.notifications, dispatchLineNotificationOutbox: jobs.line }));
vi.mock('../src/services/systemStatusService', () => ({ collectSystemStatusChecks: jobs.collect, recordSystemStatusChecks: jobs.record }));

import worker from '../src/worker';

beforeEach(() => {
  vi.resetAllMocks();
  for (const job of Object.values(jobs)) job.mockResolvedValue(0);
  jobs.collect.mockResolvedValue([]);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

it('drains both outboxes after a report failure and records the failed job', async () => {
  jobs.reports.mockRejectedValue(new Error('report failed'));
  jobs.ticket.mockResolvedValue('SLA notification queued');
  const scheduled = worker.scheduled({ scheduledTime: 1_800_000_000_000 } as ScheduledController, {} as Bindings, {} as ExecutionContext);
  await expect(scheduled).rejects.toThrow('scheduledReports');
  expect(jobs.ticket).toHaveBeenCalledOnce();
  expect(jobs.notifications).toHaveBeenCalledOnce();
  expect(jobs.line).toHaveBeenCalledOnce();
  expect(jobs.collect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scheduledJobs: expect.objectContaining({ status: 'down' }) }));
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('scheduledReports'));
  expect(jobs.record).toHaveBeenCalledOnce();
});

it('still dispatches the LINE outbox if the in-app outbox fails', async () => {
  jobs.notifications.mockRejectedValue(new Error('outbox failed'));
  const scheduled = worker.scheduled({ scheduledTime: 1_800_000_000_000 } as ScheduledController, {} as Bindings, {} as ExecutionContext);
  await expect(scheduled).rejects.toThrow('notifications');
  expect(jobs.line).toHaveBeenCalledOnce();
  expect(jobs.record).toHaveBeenCalledOnce();
});

it('reports a scheduled report failure returned as a result', async () => {
  jobs.reports.mockResolvedValue({ processed: 1, succeeded: 0, failed: 1 });
  const scheduled = worker.scheduled({ scheduledTime: 1_800_000_000_000 } as ScheduledController, {} as Bindings, {} as ExecutionContext);
  await expect(scheduled).rejects.toThrow('scheduledReports');
  expect(jobs.notifications).toHaveBeenCalledOnce();
  expect(jobs.collect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scheduledJobs: expect.objectContaining({ status: 'down' }) }));
});
