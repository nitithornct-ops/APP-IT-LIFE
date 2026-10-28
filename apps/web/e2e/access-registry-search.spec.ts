import { expect, test } from '@playwright/test';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

for (const width of [390, 1440]) {
  test(`finds a deactivation candidate at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installTicketUxFixture(page);
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { success: true, data: {
      profile: { id: 'staff-1', full_name: 'IT', email: 'test@example.test', status: 'active' },
      roles: [], permissions: ['access_registry.manage'],
    } } }));
    await page.route('**/api/v1/access-registry/deactivation-candidates?*', (route) => route.fulfill({ json: { success: true, data: [
      { id: 'candidate-101', full_name: 'User 101', email: 'user101@test.local' },
    ] } }));
    await page.goto('/admin/access-registry');
    await page.getByLabel('ค้นหาชื่อ อีเมล ชื่อบัญชี หรือรหัสพนักงาน').fill('user101');
    await expect(page.getByRole('option', { name: 'User 101 (user101@test.local)' })).toHaveCount(1);
    await page.getByLabel('ผู้ใช้ที่พ้นสภาพ').selectOption('candidate-101');
    await expect(page.getByLabel('ผู้ใช้ที่พ้นสภาพ')).toHaveValue('candidate-101');
    await page.getByLabel('ค้นหาชื่อ อีเมล ชื่อบัญชี หรือรหัสพนักงาน').locator('xpath=ancestor::form').screenshot({ path: testInfo.outputPath(`access-registry-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
