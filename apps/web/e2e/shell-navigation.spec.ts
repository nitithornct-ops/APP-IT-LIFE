import { expect, test, type Page } from '@playwright/test';
import { installTicketUxFixture, ticket } from './helpers/ticketUxFixture';

async function expectPageFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installTicketUxFixture(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { success: true, data: {
    profile: { id: 'staff-1', full_name: 'เจ้าหน้าที่ ทดสอบระบบ', email: 'ui-test@example.com', status: 'active' },
    roles: [{ role_key: 'it_admin', role_name_th: 'ผู้ดูแลระบบ' }],
    permissions: ['dashboard.view', 'ticket.view', 'ticket.create', 'service_request.view', 'asset.view', 'incident.view', 'problem.view', 'change.view', 'cmdb.view'],
  } } }));
});

for (const width of [320, 390]) {
  test(`mobile shell at ${width}px keeps controls reachable and contains drawer focus`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tickets');
    await expect(page.getByRole('link', { name: ticket.title, exact: true })).toBeVisible();
    await expectPageFits(page);
    const topbar = page.locator('.app-topbar');
    for (const control of await topbar.getByRole('button').all()) {
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole('navigation', { name: 'เมนูหลักบนมือถือ' }).getByRole('link')).toHaveCount(5);
    const menu = page.getByRole('button', { name: 'เปิดเมนู', exact: true });
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'เมนูหลัก', exact: true });
    await expect(drawer).toBeVisible();
    const close = drawer.getByRole('button', { name: 'ปิดเมนูหลัก', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.getByRole('link', { name: 'โปรไฟล์ของฉัน', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`shell-drawer-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(menu).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');

    const account = page.getByRole('button', { name: 'บัญชีผู้ใช้', exact: true });
    await account.click();
    const accountPanel = page.locator('#account-actions');
    await expect(accountPanel.getByRole('link', { name: 'โปรไฟล์ของฉัน', exact: true })).toBeVisible();
    const accountBox = await accountPanel.boundingBox();
    expect(accountBox!.x).toBeGreaterThanOrEqual(0);
    expect(accountBox!.x + accountBox!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(account).toBeFocused();
    await expect(accountPanel).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`shell-${width}.png`) });
    await expectPageFits(page);

    await menu.click();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'ค้นหาด่วน' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'เมนูหลัก', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'คำค้นหา', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
}

for (const width of [1024, 1440]) {
  test(`desktop shell at ${width}px retains a 68px collapsed menu and clear account actions`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tickets');
    await expect(page.getByRole('link', { name: ticket.title, exact: true })).toBeVisible();
    const sidebar = page.locator('#app-sidebar');
    await expect(sidebar).toHaveCSS('width', '244px');
    await expectPageFits(page);
    await page.getByRole('button', { name: 'ย่อเมนู', exact: true }).click();
    const collapsedWidth = 68;
    await expect(sidebar).toHaveCSS('width', `${collapsedWidth}px`);
    await expect(page.locator('.app-topbar')).toHaveCSS('min-height', '64px');
    await expect(sidebar.locator('a[href="/tickets"]')).toBeVisible();
    const main = await page.locator('#main-content').boundingBox();
    expect(main!.x).toBe(collapsedWidth);
    await page.screenshot({ path: testInfo.outputPath(`shell-collapsed-${width}.png`) });
    await page.getByRole('button', { name: 'ขยายเมนู', exact: true }).click();
    await expect(sidebar).toHaveCSS('width', '244px');
    await expectPageFits(page);
    await page.getByRole('button', { name: 'บัญชีผู้ใช้', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'บัญชีผู้ใช้', exact: true })).toBeFocused();
  });
}
