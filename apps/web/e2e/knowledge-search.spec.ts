import { expect, test } from '@playwright/test';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

for (const width of [390, 1440]) {
  test(`searches all visible knowledge at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installTicketUxFixture(page);
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { success: true, data: {
      profile: { id: 'staff-1', full_name: 'IT', email: 'test@example.test', status: 'active' },
      roles: [], permissions: ['knowledge.view'],
    } } }));
    await page.route('**/api/v1/knowledge*', (route) => {
      const url = new URL(route.request().url());
      const articles = url.searchParams.has('search') ? [{
        id: 'older', article_code: 'KB-OLDER', title: 'บทความเก่าที่ค้นพบ', solution: 'แนวทางแก้ไข', status: 'เผยแพร่',
        views_count: 0, helpful_count: 0, tags: [], version_number: 1,
      }] : [];
      return route.fulfill({ json: { success: true, data: { articles, categories: [], taxonomies: [], canManage: false, hasMore: false } } });
    });
    await page.goto('/knowledge');
    await page.getByPlaceholder('ค้นหาอาการ วิธีแก้ แท็ก หรือ synonym...').fill('บทความเก่า');
    await expect(page.getByText('บทความเก่าที่ค้นพบ')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`knowledge-search-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
