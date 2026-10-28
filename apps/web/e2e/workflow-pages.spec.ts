import { expect, test } from '@playwright/test';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

for (const width of [390, 1440]) {
  test(`pages workflow instances at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installTicketUxFixture(page);
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { success: true, data: {
      profile: { id: 'staff-1', full_name: 'IT', email: 'test@example.test', status: 'active' }, roles: [], permissions: ['workflow.view'],
    } } }));
    await page.route('**/api/v1/workflows', (route) => route.fulfill({ json: { success: true, data: {
      summary: { pendingMine: 0, overdueMine: 0, activeMine: 26, activeVisible: 26 }, capabilities: { canManage: false, canApprove: false, canDelegate: false, canViewAll: false },
      myApprovals: [], instances: [], definitions: [], delegations: [],
    } } }));
    await page.route('**/api/v1/workflows/instances/page?*', (route) => {
      const pageNumber = Number(new URL(route.request().url()).searchParams.get('page'));
      return route.fulfill({ json: { success: true, data: { page: pageNumber, pageSize: 25, total: 26, instances: [{
        id: `instance-${pageNumber}`, instance_code: `WF-${pageNumber}`, record_label: `งานหน้า ${pageNumber}`, record_id: `R-${pageNumber}`,
        definition_version: 1, module_key: 'ticket', status: 'กำลังดำเนินการ', approvals: [], history: [], definition: null,
      }] } } });
    });
    await page.goto('/workflows');
    await page.getByRole('button', { name: /Workflow ทั้งหมด/ }).click();
    await expect(page.getByText('งานหน้า 1')).toBeVisible();
    await expect(page.getByText('หน้า 1 · ทั้งหมด 26 รายการ')).toBeVisible();
    await page.getByRole('button', { name: 'ถัดไป' }).click();
    await expect(page.getByText('งานหน้า 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ถัดไป' })).toBeDisabled();
    await page.getByRole('button', { name: /WF-2/ }).click();
    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();
    await expect(detail.getByText('Timeline')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(page.getByText('WF-2', { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`workflows-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
