import { expect, test } from '@playwright/test';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

for (const width of [390, 1440]) {
  test(`notification configuration is clearly identified at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installTicketUxFixture(page);
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { success: true, data: {
      profile: { id: 'staff-1', full_name: 'ผู้ดูแลระบบ', email: 'test@example.test', status: 'active' },
      roles: [], permissions: ['integration.view', 'integration.manage'],
    } } }));
    await page.route('**/api/v1/integrations/overview', (route) => route.fulfill({ json: { success: true, data: {
      generatedAt: '2026-10-27T00:00:00Z', canManage: true,
      retention: { days: 90, scope: 'ข้อมูลทดสอบ' },
      summary: { activeChannels: 2, delivered24h: 0, failed24h: 0, outboxWaiting: 0, outboxFailed: 0 },
      outbox: { pending: 0, processing: 0, completed: 0, error: 0, dead: 0, cancelled: 0 },
      channels: [], templates: [], recentEvents: [],
      rules: [{ id: 'rule-1', event: 'ticket.updated', channel: 'In-app Notification', recipients: 'operator', status: 'active', managedBy: 'database' }],
    } } }));
    await page.goto('/admin/integrations');
    const panel = page.getByTestId('notification-rules-panel');
    await expect(panel.getByText(/กฎและ Template ในส่วนนี้เป็นข้อมูลตั้งค่าที่ยังไม่เชื่อม/)).toBeVisible();
    await expect(panel.getByRole('option', { name: /SMTP/ }).first()).toHaveAttribute('disabled', '');
    await panel.screenshot({ path: testInfo.outputPath(`notification-rules-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
