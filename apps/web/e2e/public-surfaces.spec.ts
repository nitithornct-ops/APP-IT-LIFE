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
});
