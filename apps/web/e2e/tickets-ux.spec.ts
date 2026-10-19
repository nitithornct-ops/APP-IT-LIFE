import { expect, test, type Page } from '@playwright/test';
import { installTicketUxFixture, ticket } from './helpers/ticketUxFixture';

async function expectPageFits(page: Page) {
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.width);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installTicketUxFixture(page);
});

for (const width of [390, 768, 1440]) {
  test.describe(`ticket UX at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('keeps list data readable and returns to the same filters and page', async ({ page }, testInfo) => {
      await page.goto('/tickets?status=ใหม่&page=2&sort=due_at&order=asc');
      await expect(page.getByRole('link', { name: ticket.title, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ticket ทั้งหมด: 12', exact: true })).toBeVisible();
      await expectPageFits(page);
      // Clicking ordinary data must not open an unexpected preview.
      await page.locator('td[data-label="ผู้แจ้ง"]').first().click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).toHaveURL(/\/tickets\?/);
      await page.screenshot({ path: testInfo.outputPath(`ticket-list-${width}.png`), fullPage: true });

      await page.getByRole('link', { name: ticket.title, exact: true }).click();
      await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeInViewport();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'แจ้งซ่อม / Help Desk', exact: true })).toHaveCount(0);
      await expect(page.getByTestId('ticket-work-panel')).toBeVisible();
      await expectPageFits(page);
      await page.screenshot({ path: testInfo.outputPath(`ticket-detail-${width}.png`), fullPage: true });
      await page.getByRole('link', { name: 'กลับไปรายการ', exact: true }).click();
      const url = new URL(page.url());
      expect(url.pathname).toBe('/tickets');
      expect(url.searchParams.get('status')).toBe('ใหม่');
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('sort')).toBe('due_at');
      await expect(page.getByLabel('กรองตามสถานะ')).toHaveValue('ใหม่');
      await page.getByRole('link', { name: `รายละเอียด ${ticket.ticket_no}`, exact: true }).click();
      await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeInViewport();
      await page.getByRole('link', { name: 'กลับไปรายการ', exact: true }).click();
      expect(new URL(page.url()).searchParams.get('page')).toBe('2');
    });

    test('keeps submit reachable, focuses the problem and validates without losing input', async ({ page }, testInfo) => {
      await page.goto('/tickets');
      const open = page.getByRole('button', { name: 'เปิด Ticket', exact: true });
      await open.click();
      const dialog = page.getByRole('dialog', { name: 'เปิด Ticket แจ้งซ่อม' });
      const title = dialog.getByLabel(/หัวข้อปัญหา/);
      const submit = dialog.getByRole('button', { name: 'เปิด Ticket', exact: true });
      await expect(title).toBeFocused();
      await expect(submit).toBeInViewport();
      expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectPageFits(page);
      await page.screenshot({ path: testInfo.outputPath(`ticket-create-${width}.png`) });
      await submit.click();
      await expect(title).toHaveAttribute('aria-invalid', 'true');
      await title.fill('เครื่องพิมพ์ไม่ทำงาน');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('button', { name: 'กลับไปแก้ไข' }).click();
      await expect(title).toHaveValue('เครื่องพิมพ์ไม่ทำงาน');
      await dialog.getByLabel(/ประเภทงานที่ขอรับบริการ/).selectOption('11111111-1111-4111-8111-111111111111');
      await dialog.getByLabel(/รายละเอียดปัญหา/).fill('ลองเชื่อมต่อใหม่แล้วแต่ยังพิมพ์ไม่ได้');
      await submit.click();
      await expect(dialog).toHaveCount(0);
      await expect(open).toBeFocused();
    });
  });
}
