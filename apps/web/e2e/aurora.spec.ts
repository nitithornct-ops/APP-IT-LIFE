import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import { installTicketUxFixture, ticket } from './helpers/ticketUxFixture';

for (const width of [390, 768, 1440]) {
  test(`Aurora density, fonts and navigation at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installTicketUxFixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/tickets');
    await expect(page.getByRole('link', { name: ticket.title, exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (width === 1440) {
      await page.getByRole('button', { name: 'เพิ่มหน้านี้ในรายการโปรด' }).click();
      await expect(page.locator('#app-sidebar nav a[href="/tickets"]')).toHaveCount(1);
      await expect(page.locator('#app-sidebar').getByRole('button', { name: 'รายการโปรด', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.locator('#app-sidebar').getByRole('button', { name: 'นำหน้านี้ออกจากรายการโปรด' })).toBeVisible();
      await page.getByRole('button', { name: 'นำหน้านี้ออกจากรายการโปรด' }).click();
      await page.getByRole('link', { name: 'สร้าง Ticket ด่วน', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'เปิด Ticket แจ้งซ่อม' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).not.toHaveURL(/create=1/);
    }
    const fontSize = await page.locator('body').evaluate(el => getComputedStyle(el).fontSize);
    for (const density of ['compact', 'standard', 'comfortable']) {
      if (width < 1280) await page.getByRole('button', { name: 'บัญชีผู้ใช้', exact: true }).click();
      await page.getByLabel('ความหนาแน่นข้อมูล', { exact: true }).filter({ visible: true }).selectOption(density);
      await expect(page.locator('html')).toHaveAttribute('data-density', density);
      if (width < 1280) await page.keyboard.press('Escape');
      await expect(page.locator('body')).toHaveCSS('font-size', fontSize);
      const spacing = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-row-height').trim());
      expect(spacing).toBe({ compact: '36px', standard: '44px', comfortable: '52px' }[density]);
      if (width === 390) expect(await page.getByRole('button', { name: 'แจ้งซ่อมใหม่', exact: true }).evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath(`tickets-${width}-${density}.png`), fullPage: true });
    }
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
    await expect(page.getByRole('link', { name: ticket.title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // Confirm the downloaded family provides Thai glyphs, rather than a fallback.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.life-page-title h1' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(fonts.some(font => font.familyName.includes('Noto Sans Thai') && font.isCustomFont)).toBe(true);
    if (width === 1440) {
      const result = await new AxeBuilder({ page }).include('.app-topbar').include('#app-sidebar').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
    }
    expect(errors).toEqual([]);
    const timing = JSON.stringify(await page.evaluate(() => ({
      navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()),
      resources: performance.getEntriesByType('resource').filter(entry => /\.(woff2|css|js)/.test(entry.name)).map(entry => entry.toJSON()),
    })), null, 2);
    const timingPath = testInfo.outputPath('local-resource-timing.json');
    await writeFile(timingPath, timing);
    await testInfo.attach('local-resource-timing', { path: timingPath, contentType: 'application/json' });
  });
}

for (const width of [390, 1440]) {
  test(`dashboard remains a permission-aware compact workspace at ${width}px`, async ({ page }, testInfo) => {
    await installTicketUxFixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { success: true, data: {
      profile: { id: 'staff-1', full_name: 'เจ้าหน้าที่ IT', email: 'ui-test@example.test', status: 'active', onboarding_completed_at: '2026-10-29T00:00:00Z' },
      roles: [], permissions: ['dashboard.view', 'ticket.view', 'ticket.create'],
    } } }));
    await page.route('**/api/v1/dashboard/summary?*', route => route.fulfill({ json: { success: true, data: {
      mode: 'operations', metrics: [{ key: 'tickets', label: 'งานเปิด', value: 12, note: 'ทุกคิว', tone: 'primary', path: '/tickets' }],
      cards: [{ key: 'tickets', label: 'Ticket', path: '/tickets', total: 12, warning: 3, overdue: 2, truncated: false, scanned: 12, tone: 'danger' }],
      upcoming: [], decisions: [], breakdowns: [], executiveAnalytics: null, alertCount: 2, leadDays: 30, generatedAt: '2026-10-29T02:00:00Z',
    } } }));
    await page.goto('/');
    await expect(page.getByTestId('dashboard-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: /วันนี้มี 2 เรื่อง/ })).toBeVisible();
    await expect(page.locator('#app-sidebar a[href="/admin/settings"]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('vendor login inherits the public dark theme without exposing internal navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('itlife-theme', 'dark'));
  await page.route('**/api/v1/vendor-portal/**', route => route.fulfill({ status: 503, json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'บริการไม่พร้อมใช้งาน กรุณาลองใหม่' } } }));
  await page.route('https://challenges.cloudflare.com/turnstile/**', route => route.fulfill({ contentType: 'application/javascript', body: 'window.turnstile = { render: () => "test", reset: () => {}, remove: () => {} };' }));
  await page.goto('/vendor/portal');
  await expect(page.getByRole('heading', { name: 'Outsource Portal' })).toBeVisible();
  await expect(page.locator('main')).toHaveClass(/life-public/);
  await expect(page.locator('#app-sidebar')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('vendor-login-dark-390.png'), fullPage: true });
});
