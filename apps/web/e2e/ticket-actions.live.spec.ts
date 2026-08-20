import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test.skip(process.env.LIVE_TICKET_ACTIONS_E2E !== '1', 'Live Ticket action E2E is opt-in');

test('opens the shared work panel from the Ticket list and explains final statuses', async ({ page }) => {
  const email = process.env.UAT_ADMIN_EMAIL;
  const password = process.env.UAT_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('UAT credentials are required');

  await page.goto('/login');
  await page.getByLabel('อีเมล', { exact: true }).fill(email);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });

  await page.goto('/tickets');
  await expect(page.getByRole('heading', { name: 'Ticket', exact: true })).toBeVisible({ timeout: 20_000 });

  const workAction = page.getByRole('link', { name: /(?:ดำเนินการ|ตรวจสอบ \/ ปิดงาน) TCK-/ }).first();
  await expect(workAction).toBeVisible();
  await workAction.click();

  await expect(page).toHaveURL(/\/tickets\/[^/?#]+\?action=edit#ticket-work-panel$/);
  const panel = page.getByTestId('ticket-work-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('ดำเนินการ / แก้ไข Ticket', { exact: true })).toBeVisible();

  const status = panel.getByLabel('สถานะ', { exact: true });
  await expect(status.locator('option', { hasText: 'ซ่อมเสร็จ (รอยืนยัน)' })).toHaveCount(1);
  await expect(status.locator('option', { hasText: 'ปิดงานแล้ว' })).toHaveCount(1);
  await page.screenshot({ path: resolve(process.cwd(), '../../test-results/ticket-actions-fixed.png'), fullPage: true });
});
