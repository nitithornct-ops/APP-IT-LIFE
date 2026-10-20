import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { installTicketUxFixture, ticket } from './helpers/ticketUxFixture';

for (const width of [390, 768, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`shared UI at ${width}px in ${theme} with enlarged text`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await installTicketUxFixture(page);
      await page.goto('/tickets');
      await expect(page.getByRole('link', { name: ticket.title, exact: true })).toBeVisible();
      if (theme === 'dark') await page.getByRole('button', { name: /ธีม:/ }).click();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);

      // Mobile exposes the same persistent scale through the account menu.
      if (width < 640) await page.getByRole('button', { name: 'บัญชีผู้ใช้', exact: true }).click();
      const increase = page.getByRole('button', { name: 'เพิ่มขนาดตัวอักษร', exact: true }).filter({ visible: true });
      await increase.click();
      await increase.click();
      await expect(increase).toBeDisabled();
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('19.2px');
      if (width < 640) await page.getByRole('button', { name: 'บัญชีผู้ใช้', exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`list-${width}-${theme}-120.png`), fullPage: true });

      await page.getByRole('button', { name: 'เปิด Ticket', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'เปิด Ticket แจ้งซ่อม' });
      await expect(dialog.getByRole('button', { name: 'เปิด Ticket', exact: true })).toBeInViewport();
      const field = dialog.getByLabel(/หัวข้อปัญหา/);
      await expect(field).toBeFocused();
      expect(await field.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(19);
      expect(await field.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath(`create-${width}-${theme}-120.png`) });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(dialog).toHaveCount(0);

      await page.getByRole('link', { name: ticket.title, exact: true }).click();
      await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`detail-${width}-${theme}-120.png`), fullPage: true });
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.width);

      // CSS font-family alone cannot prove which font rendered the Thai glyphs.
      const session = await page.context().newCDPSession(page);
      await session.send('DOM.enable');
      await session.send('CSS.enable');
      const { root } = await session.send('DOM.getDocument');
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.life-page-title h1 > span' });
      const renderedFonts = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      expect(renderedFonts.fonts.length).toBeGreaterThan(0);
      const fontReport = testInfo.outputPath('rendered-thai-fonts.json');
      await writeFile(fontReport, JSON.stringify(renderedFonts, null, 2));
      await testInfo.attach('rendered-thai-fonts.json', { path: fontReport, contentType: 'application/json' });
    });
  }
}

test('recoverable save failure preserves the ticket draft', async ({ page }) => {
  await installTicketUxFixture(page);
  await page.route('**/api/v1/tickets', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({ status: 503, json: { success: false, error: { code: 'TEMPORARILY_UNAVAILABLE', message: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' } } });
  });
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'เปิด Ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/หัวข้อปัญหา/).fill('เครื่องพิมพ์ไม่ตอบสนอง');
  await dialog.getByLabel(/รายละเอียดปัญหา/).fill('ลองเชื่อมต่อใหม่แล้วยังพิมพ์ไม่ได้');
  await dialog.getByLabel(/ประเภทงานที่ขอรับบริการ/).selectOption('11111111-1111-4111-8111-111111111111');
  await dialog.getByRole('button', { name: 'เปิด Ticket', exact: true }).click();
  await expect(dialog.getByText('บันทึกไม่สำเร็จ กรุณาลองใหม่')).toBeVisible();
  await expect(dialog.getByLabel(/หัวข้อปัญหา/)).toHaveValue('เครื่องพิมพ์ไม่ตอบสนอง');
  await expect(dialog.getByRole('button', { name: 'เปิด Ticket', exact: true })).toBeEnabled();
});
