import { expect, test } from '@playwright/test';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

test('protects unsaved Form Studio work on browser back and menu navigation', async ({ page }) => {
  await installTicketUxFixture(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { success: true, data: {
    profile: { id: 'staff-1', full_name: 'IT', email: 'test@example.test', status: 'active' },
    roles: [], permissions: ['form.view', 'form.manage', 'ticket.view'],
  } } }));
  await page.route('**/api/v1/forms/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/templates') ? [{
      id: 'template-1', template_code: 'IT-ERP-ISSUE', name: 'เอกสารทดสอบ', category: 'IT Support', status: 'Published', current_version: 1,
      content_html: '<p>เนื้อหา</p>', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    }] : path.endsWith('/references') ? { vendors: [], tickets: [], sources: [] } : [];
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto('/tickets');
  await page.locator('a[href="/forms"]').first().click();
  await page.getByRole('button', { name: 'เปิดใน Editor' }).click();
  const title = page.getByLabel('ชื่อเอกสาร');
  await expect(title).toBeVisible();
  await title.fill('ร่างที่ยังไม่บันทึก');
  await expect(page.getByText('ยังไม่บันทึก', { exact: true })).toBeVisible();
  await page.goBack();
  const dialog = page.getByRole('dialog', { name: 'มีการแก้ไขที่ยังไม่บันทึก' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'อยู่ต่อ' }).click();
  await expect(title).toHaveValue('ร่างที่ยังไม่บันทึก');
  await page.locator('a[href="/tickets"]').first().click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'ทิ้งการแก้ไข' }).click();
  await expect(page).toHaveURL(/\/tickets(?:\?.*)?$/);
});
