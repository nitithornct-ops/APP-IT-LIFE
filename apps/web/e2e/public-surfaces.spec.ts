import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe('public redesign acceptance', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('login remains readable in mobile dark mode', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');

    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ลืมรหัสผ่าน?' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.screenshot({ path: testInfo.outputPath('login-mobile-dark.png'), fullPage: true });
  });

  test('public ticket form loads categories without mobile overflow', async ({ page }, testInfo) => {
    await page.route('**/api/v1/public/tickets/form-data', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            enabled: true,
            categories: [
              { id: 'hardware', name: 'อุปกรณ์คอมพิวเตอร์', response_sla_hours: 2, resolution_sla_hours: 8, sla_hours: 8 },
              { id: 'network', name: 'ระบบเครือข่าย', response_sla_hours: 1, resolution_sla_hours: 4, sla_hours: 4 },
            ],
            priorities: ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'],
            privacy: { version: 'test', summary: 'ใช้ข้อมูลเพื่อดำเนินการแจ้งซ่อม', dpoContact: 'DPO / IT' },
          },
          requestId: 'public-redesign-test',
        }),
      });
    });

    await page.goto('/report');

    await expect(page.getByRole('heading', { name: 'แจ้งซ่อม' })).toBeVisible();
    await expect(page.locator('#category option')).toHaveCount(3);
    await expect(page.getByText('กำลังโหลดประเภทปัญหา...')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.screenshot({ path: testInfo.outputPath('public-ticket-mobile.png'), fullPage: true });
  });
});
