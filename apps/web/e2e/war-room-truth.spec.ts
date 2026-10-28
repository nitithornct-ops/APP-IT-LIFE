import { expect, test } from '@playwright/test';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

for (const width of [390, 1440]) {
  test(`labels the work data and freshness at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installTicketUxFixture(page);
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { success: true, data: {
      profile: { id: 'staff-1', full_name: 'IT', email: 'test@example.test', status: 'active' },
      roles: [], permissions: ['dashboard.view'],
    } } }));
    await page.route('**/api/v1/dashboard/summary?*', (route) => route.fulfill({ json: { success: true, data: {
      mode: 'operations', metrics: [{ label: 'งานเปิด', value: 12, note: 'ทุกคิว', tone: 'primary', path: '/tickets' }],
      cards: [{ key: 'tickets', label: 'Ticket', path: '/tickets', total: 12, warning: 3, overdue: 2, truncated: false, scanned: 12, tone: 'danger' }],
      upcoming: [{ id: 'TK-1', source: 'Ticket', title: 'ติดตามงาน', status: 'เปิด', dueAt: '2026-10-01T00:00:00Z', daysRemaining: -1, tone: 'danger', path: '/tickets/1' }],
      breakdowns: [], executiveAnalytics: null, alertCount: 2, leadDays: 7, generatedAt: '2020-01-01T00:00:00Z',
    } } }));
    await page.goto('/war-room');
    await expect(page.getByText('ข้อมูลอาจไม่เป็นปัจจุบัน')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ปริมาณงานตามโมดูล' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ฟีดความเคลื่อนไหว' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`war-room-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
