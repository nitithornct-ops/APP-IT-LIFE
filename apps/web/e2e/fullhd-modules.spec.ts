import { expect, test } from '@playwright/test';
import { NAV_GROUPS } from '../src/config/navigation';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

const items = NAV_GROUPS.flatMap(group => group.items);
const permissions = [...new Set(items.flatMap(item => [...(item.permission ? [item.permission] : []), ...(item.anyPermission ?? [])]))];
const viewports = [[1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [390, 844], [375, 812]];

// Recovery surfaces cover every navigation entry. Success/detail/create flows
// require their own fixtures or live UAT; this suite makes no workflow claim.
for (const item of items) {
  test(`all viewport recovery geometry ${item.path}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installTicketUxFixture(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/v1/**', route => {
      if (/\/auth\/|\/notifications$|\/settings\/branding$/.test(new URL(route.request().url()).pathname)) return route.fallback();
      return route.fulfill({ status: 503, json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'บริการไม่พร้อมใช้งาน กรุณาลองใหม่' } } });
    });
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { success: true, data: {
      profile: { id: 'staff-1', full_name: 'เจ้าหน้าที่ IT', email: 'ui-test@example.test', status: 'active', onboarding_completed_at: '2026-10-29T00:00:00Z' },
      roles: [{ role_key: 'it_admin', role_name_th: 'ผู้ดูแลระบบ' }], permissions,
    } } }));
    await page.goto(item.path);
    await expect(page.locator('#main-content h1, #main-content [role="alert"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('access-denied')).toHaveCount(0);
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
        const geometry = await page.evaluate(() => {
          const m = document.querySelector('#main-content')!.getBoundingClientRect();
          const c = document.querySelector('.module-page-content')!.getBoundingClientRect();
          return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, gutterDifference: Math.abs(c.left - m.left - (m.right - c.right)) };
        });
        expect(geometry.overflow, `${item.path} ${width} dark=${dark}`).toBeLessThanOrEqual(1);
        expect(geometry.gutterDifference, `${item.path} ${width}`).toBeLessThanOrEqual(1);
      }
      if (width === 1920) await page.screenshot({ path: testInfo.outputPath('recovery-fullhd.png'), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}
