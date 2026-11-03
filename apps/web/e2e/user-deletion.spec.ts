import { expect, test } from '@playwright/test';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

for (const width of [390, 1440]) {
  test(`self-service user deletion preserves history at ${width}px`, async ({ page }, testInfo) => {
    await installTicketUxFixture(page);
    await page.setViewportSize({ width, height: 900 });
    let removed = false;
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { success: true, data: {
      profile: { id: 'staff-1', full_name: 'ผู้ดูแลระบบ', email: 'admin@example.test', status: 'active', onboarding_completed_at: '2026-10-29T00:00:00Z' },
      roles: [{ role_key: 'it_admin', role_name_th: 'ผู้ดูแลระบบ' }], permissions: ['user.manage', 'role.manage'],
    } } }));
    await page.route('**/api/v1/users**', async route => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown;
      if (path.endsWith('/deletion-preview')) data = { hasDependencies: true, dependencies: [{ table: 'tickets', column: 'requester_id', count: 3 }, { table: 'notifications', column: 'recipient_id', count: 2 }] };
      else if (route.request().method() === 'DELETE') {
        expect(route.request().postDataJSON()).toEqual({ reason: 'พนักงานลาออก', mode: 'preserve-history' });
        removed = true;
        data = { removed: true };
      } else data = { items: removed ? [] : [{ id: 'user-1', full_name: 'สมชาย ทดสอบ', username: 'somchai', email: 'somchai@example.test', status: 'inactive', created_at: '2026-10-01T00:00:00Z' }], pagination: { page: 1, pageSize: 20, totalItems: removed ? 0 : 1, totalPages: 1 } };
      await route.fulfill({ json: { success: true, data } });
    });
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'ลบผู้ใช้งาน somchai', exact: true }).click();
    await expect(page.getByText('ใบแจ้งงาน: 3 รายการ')).toBeVisible();
    await expect(page.getByRole('radio', { name: /ลบถาวร/ })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath(`user-deletion-${width}.png`), fullPage: true });
    await page.getByRole('textbox', { name: 'เหตุผลการลบ' }).fill('พนักงานลาออก');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'ยืนยันลบบัญชี' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('สมชาย ทดสอบ', { exact: true })).toHaveCount(0);
    expect(removed).toBe(true);
  });
}
