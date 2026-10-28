import { expect, test } from '@playwright/test';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

for (const width of [390, 1920]) {
  test(`license and vulnerability details open over the list at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 844 });
    await installTicketUxFixture(page);
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { success: true, data: {
      profile: { id: 'staff-1', full_name: 'IT', email: 'test@example.test', status: 'active' }, roles: [], permissions: ['license.view', 'vulnerability.view'],
    } } }));
    const pagination = { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 };
    await page.route('**/api/v1/software-licenses/summary', route => route.fulfill({ json: { success: true, data: { pricedCount: 0 } } }));
    await page.route('**/api/v1/software-licenses?*', route => route.fulfill({ json: { success: true, data: { pagination, items: [{
      id: 'lic-1', license_code: 'LIC-1', software_name: 'Example License', product_name: 'Example License', license_model: 'SaaS',
      status: 'Active', total_qty: 10, used_qty: 4, start_date: null, expire_date: null, expiry_notice_days: 30, renewal_approval_status: 'pending', notes: 'License note',
    }] } } }));
    await page.route('**/api/v1/vulnerabilities?*', route => route.fulfill({ json: { success: true, data: { pagination, items: [{
      id: 'vuln-1', vulnerability_code: 'VULN-1', title: 'Example finding', risk_priority: 'P1', severity: '\u0e2a\u0e39\u0e07', status: '\u0e40\u0e1b\u0e34\u0e14',
      due_date: null, sla_due_date: null, risk_factors: { reasons: ['Example risk'] }, exception_status: 'not_requested',
    }] } } }));
    for (const entry of [
      { path: '/software-licenses', row: 'lic-row-lic-1', content: 'License note' },
      { path: '/vulnerabilities', row: 'vuln-row-vuln-1', content: 'Example risk' },
    ]) {
      await page.goto(entry.path);
      const row = page.getByTestId(entry.row);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(entry.content)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(row).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
}

test('task previews open over the list and close without losing the list', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installTicketUxFixture(page);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { success: true, data: {
    profile: { id: 'staff-1', full_name: 'IT', email: 'test@example.test', status: 'active' }, roles: [], permissions: ['task.view'],
  } } }));
  await page.route('**/api/v1/tasks/dashboard', route => route.fulfill({ json: { success: true, data: { todayItems: [] } } }));
  await page.route('**/api/v1/tasks', route => route.fulfill({ json: { success: true, data: [{
    id: 'task-1', task_no: 'TSK-1', title: 'Example task', description: 'Example task description', task_type: 'general',
    category: '\u0e07\u0e32\u0e19\u0e17\u0e31\u0e48\u0e27\u0e44\u0e1b', priority: '\u0e1b\u0e01\u0e15\u0e34', status: '\u0e15\u0e49\u0e2d\u0e07\u0e17\u0e33',
    recurrence: '\u0e44\u0e21\u0e48\u0e17\u0e33\u0e0b\u0e49\u0e33', progress: 20, due_days: null, due_date: null, subtasks: [], dependencies: [], relations: [],
  }] } }));
  await page.goto('/tasks?scope=all&view=list');
  await page.getByRole('article').filter({ hasText: 'Example task' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Example task description')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('article').filter({ hasText: 'Example task' })).toBeVisible();
});

test('inventory ledger and stock actions open in dialogs', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installTicketUxFixture(page);
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { success: true, data: {
    profile: { id: 'staff-1', full_name: 'IT', email: 'test@example.test', status: 'active' }, roles: [], permissions: ['inventory.view', 'inventory.manage'],
  } } }));
  const emptyPage = { items: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } };
  await page.route('**/api/v1/inventory-items/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/options') ? { vendors: [], warehouses: [], bins: [] }
      : path.endsWith('/requests') || path.endsWith('/purchase-receipts') ? emptyPage : [];
    return route.fulfill({ json: { success: true, data } });
  });
  await page.route('**/api/v1/inventory-items?*', route => route.fulfill({ json: { success: true, data: { ...emptyPage, items: [{
    id: 'item-1', item_name: 'Example stock', stock_qty: 12, available_qty: 12, reserved_qty: 0, reorder_point: 3, unit: 'box', value: 100,
  }] } } }));
  await page.goto('/inventory-items');
  await page.getByTestId('inv-action-ledger-item-1').click();
  await expect(page.getByRole('dialog', { name: 'Ledger' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('inv-action-in-item-1').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=number]').fill('2');
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button').last().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('inv-row-item-1')).toBeVisible();
});
