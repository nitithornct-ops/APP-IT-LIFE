import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installTicketUxFixture, ticket } from './helpers/ticketUxFixture';

for (const scheme of ['light', 'dark'] as const) {
  test(`system theme follows ${scheme} and primary controls retain readable contrast`, async ({ page }) => {
    await installTicketUxFixture(page);
    await page.addInitScript(() => localStorage.setItem('itlife-theme', 'system'));
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/tickets');
    await expect(page.getByRole('link', { name: ticket.title, exact: true })).toBeVisible();
    const background = scheme === 'light' ? 'rgb(247, 249, 252)' : 'rgb(16, 23, 34)';
    await expect(page.locator('.life-app')).toHaveCSS('background-color', background);
    const create = page.getByRole('button', { name: 'แจ้งซ่อมใหม่', exact: true });
    await expect(create).toHaveCSS('background-color', 'rgb(246, 130, 31)');
    for (const hovered of [false, true]) {
      if (hovered) await create.hover();
      // Scan actual rendered normal/hover states, including dark mode.
      const report = await new AxeBuilder({ page })
        .include('[data-ui="button"][data-variant="primary"]')
        .withRules(['color-contrast']).analyze();
      expect(report.violations, JSON.stringify(report.violations)).toEqual([]);
    }
    // System selection continues responding to OS preference changes.
    const next = scheme === 'light' ? 'dark' : 'light';
    await page.emulateMedia({ colorScheme: next });
    await expect(page.locator('.life-app')).toHaveCSS('background-color',
      next === 'light' ? 'rgb(247, 249, 252)' : 'rgb(16, 23, 34)');
  });
}

for (const mode of ['executive', 'privacy', 'operations', 'personal'] as const) {
  for (const width of [390, 1920]) {
    test(`${mode} dashboard renders only its API summary at ${width}px`, async ({ page }, testInfo) => {
      await installTicketUxFixture(page);
      await page.setViewportSize({ width, height: width === 1920 ? 1080 : 844 });
      await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { success: true, data: {
        profile: { id: 'staff-1', full_name: 'UI Test', status: 'active', onboarding_completed_at: '2026-10-29T00:00:00Z' },
        roles: [], permissions: ['dashboard.view', 'ticket.view'],
      } } }));
      await page.route('**/api/v1/dashboard/summary?*', route => route.fulfill({ json: { success: true, data: {
        mode, metrics: [{ key: 'tickets', label: 'งานเปิด', value: 12, note: 'ข้อมูลจำลองสำหรับ UI test', tone: 'primary', path: '/tickets' }],
        cards: [], upcoming: [], decisions: [], breakdowns: [], executiveAnalytics: null,
        alertCount: 0, leadDays: 30, generatedAt: '2026-10-29T02:00:00Z',
      } } }));
      await page.goto('/');
      await expect(page.getByTestId('dashboard-page')).toBeVisible();
      await expect(page.getByRole('link', { name: 'งานเปิด: 12', exact: true })).toBeVisible();
      await expect(page.locator('#app-sidebar a[href="/admin/settings"]')).toHaveCount(0);
      await expect(page.getByTestId('dashboard-backup-health')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`dashboard-${mode}-${width}.png`), fullPage: true });
    });
  }
}
