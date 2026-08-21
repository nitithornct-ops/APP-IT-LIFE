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

test('sorts the Ticket list by SLA due date and keeps the sort across pages', async ({ page }) => {
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

  const slaHeader = page.getByRole('columnheader', { name: /สถานะ\/SLA/ });
  await expect(slaHeader).toHaveAttribute('aria-sort', 'none');

  const sortButton = page.getByRole('button', { name: /เรียงตามวันครบกำหนด SLA/ });
  const ascendingRequest = page.waitForResponse((response) =>
    response.url().includes('/api/v1/tickets?') && response.url().includes('sort=due_at') && response.url().includes('order=asc'));
  await sortButton.click();
  await ascendingRequest;
  await expect(slaHeader).toHaveAttribute('aria-sort', 'ascending');

  // ข้ามไปหน้าถัดไปแล้วการเรียงต้องยังอยู่ ทั้งใน request และใน aria-sort
  const nextPage = page.getByRole('button', { name: 'หน้าถัดไป', exact: true });
  if (await nextPage.isEnabled()) {
    const pagedRequest = page.waitForResponse((response) =>
      response.url().includes('/api/v1/tickets?') && response.url().includes('sort=due_at') && response.url().includes('page=2'));
    await nextPage.click();
    await pagedRequest;
    await expect(slaHeader).toHaveAttribute('aria-sort', 'ascending');
  }

  const descendingRequest = page.waitForResponse((response) =>
    response.url().includes('/api/v1/tickets?') && response.url().includes('order=desc'));
  await sortButton.click();
  await descendingRequest;
  await expect(slaHeader).toHaveAttribute('aria-sort', 'descending');

  await page.screenshot({ path: resolve(process.cwd(), '../../test-results/ticket-sort-sla.png'), fullPage: true });
});

test('keeps the Ticket list filter and sort in the URL across reload and browser back', async ({ page }) => {
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

  // เรียงก่อนกรอง เพราะเมื่อกรองแคบลงแล้วอาจไม่เหลือแถวในสภาพแวดล้อมจริง และหัวตารางจะหายไปพร้อมกับปุ่มเรียง
  await page.getByRole('button', { name: /เรียงตามวันครบกำหนด SLA/ }).click();
  await expect(page).toHaveURL(/[?&]sort=due_at/);
  await expect(page).toHaveURL(/[?&]order=asc/);
  // รอให้หน้าจอสะท้อนการเรียงก่อนค่อยแตะตัวกรอง — URL เปลี่ยนทันทีที่ pushState
  // แต่ React อาจยัง render ไม่เสร็จ การกดต่อทันทีจึงเป็นการแข่งกับจังหวะที่ผู้ใช้จริงไม่เจอ
  await expect(page.getByRole('columnheader', { name: /สถานะ\/SLA/ })).toHaveAttribute('aria-sort', 'ascending');

  const priorityFilter = page.getByLabel('กรองตามความเร่งด่วน', { exact: true });
  await priorityFilter.selectOption('วิกฤต');
  await expect(page).toHaveURL(/[?&]priority=/);
  await expect(page).toHaveURL(/[?&]sort=due_at/);

  // refresh แล้วค่าต้องคงเดิม — สถานะอยู่ใน URL ไม่ใช่ใน memory
  const sharedUrl = page.url();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ticket', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(priorityFilter).toHaveValue('วิกฤต');
  expect(page.url()).toBe(sharedUrl);

  // ปุ่ม Back ต้องย้อนตัวกรองออกก่อน แล้วค่อยย้อนการเรียง
  await page.goBack();
  await expect(priorityFilter).toHaveValue('');
  await expect(page).toHaveURL(/[?&]sort=due_at/);
  // พอตัวกรองหลุดออก ตารางกลับมามีแถว การเรียงที่อ่านจาก URL ต้องยังอยู่
  await expect(page.getByRole('columnheader', { name: /สถานะ\/SLA/ })).toHaveAttribute('aria-sort', 'ascending');

  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]sort=due_at/);

  await page.screenshot({ path: resolve(process.cwd(), '../../test-results/ticket-url-state.png'), fullPage: true });
});

test('selects tickets and reports bulk results per ticket', async ({ page }) => {
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

  const selectAll = page.getByRole('checkbox', { name: 'เลือกทุกรายการในหน้านี้', exact: true });
  await expect(selectAll).toBeVisible();
  await selectAll.check();

  const summary = page.getByRole('status').filter({ hasText: 'เลือก' }).first();
  await expect(summary).toBeVisible();

  await page.getByRole('button', { name: 'ดำเนินการกับที่เลือก', exact: true }).click();
  await expect(page.getByRole('heading', { name: /ดำเนินการ \d+ ใบงาน/ })).toBeVisible();

  // เปลี่ยนสถานะทีละหลายใบต้องเลือกได้เฉพาะสถานะระหว่างทำงานเท่านั้น
  await page.getByRole('button', { name: 'เปลี่ยนสถานะ', exact: true }).click();
  const statusSelect = page.getByLabel('สถานะใหม่', { exact: true });
  await expect(statusSelect.locator('option')).toHaveCount(4);
  await expect(statusSelect.locator('option', { hasText: 'ปิดงานแล้ว' })).toHaveCount(0);

  const bulkResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/tickets/bulk') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'ดำเนินการ', exact: true }).click();
  const result = await bulkResponse;
  const payload = await result.json();
  expect(Array.isArray(payload.data.succeeded)).toBe(true);
  expect(Array.isArray(payload.data.failed)).toBe(true);

  await page.screenshot({ path: resolve(process.cwd(), '../../test-results/ticket-bulk-result.png'), fullPage: true });
});
