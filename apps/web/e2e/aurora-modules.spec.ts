import { expect, test } from '@playwright/test';
import { NAV_GROUPS } from '../src/config/navigation';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

const items = NAV_GROUPS.flatMap(group => group.items);
const permissions = [...new Set(items.flatMap(item => [...(item.permission ? [item.permission] : []), ...(item.anyPermission ?? [])]))];

// Exercise every navigation module's recoverable service-error surface without
// contacting a live database or manufacturing production records.
for (const width of [390, 1440]) {
  for (const item of items) {
    test(`module recovery surface ${item.path} at ${width}px`, async ({ page }, testInfo) => {
      await installTicketUxFixture(page);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      let serviceRequests = 0;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (/\/auth\/|\/notifications$|\/settings\/branding$/.test(path)) return route.fallback();
        serviceRequests += 1;
        return route.fulfill({ status: 503, json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'บริการไม่พร้อมใช้งาน กรุณาลองใหม่' } } });
      });
      await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { success: true, data: {
        profile: { id: 'staff-1', full_name: 'เจ้าหน้าที่ IT', email: 'ui-test@example.test', status: 'active', onboarding_completed_at: '2026-10-29T00:00:00Z' },
        roles: [{ role_key: 'it_admin', role_name_th: 'ผู้ดูแลระบบ' }], permissions,
      } } }));
      await page.goto(item.path);
      await expect(page.locator('#main-content')).toBeVisible();
      // Several modules intentionally replace their header with QueryError after
      // React Query's retry window; allow the real recovery surface to settle.
      await expect(page.locator('#main-content h1, #main-content [role="alert"]').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('html')).toHaveAttribute('data-density', 'standard');
      await expect(page.getByTestId('access-denied')).toHaveCount(0);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (['/service-requests', '/admin/service-catalog', '/workflows', '/knowledge', '/backup-monitoring'].includes(item.path)) {
        const retry = page.locator('#main-content').getByRole('button', { name: 'ลองใหม่', exact: true });
        await expect(retry).toBeVisible();
        const before = serviceRequests;
        await retry.click();
        await expect.poll(() => serviceRequests).toBeGreaterThan(before);
      }
      if (['/assets', '/governance', '/reports', '/admin/users'].includes(item.path)) {
        await page.screenshot({ path: testInfo.outputPath(`${item.path.replaceAll('/', '-')}-${width}-recovery.png`), fullPage: true });
      }
    });
  }
}
