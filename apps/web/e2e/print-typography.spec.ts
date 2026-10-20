import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

test('A4 retains its font, page breaks and signature when UI text grows', async ({ page }, testInfo) => {
  await installTicketUxFixture(page);
  await page.route('**/api/v1/tickets/ticket-1/form-document', route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { success: true, data: {
    ticketId: 'ticket-1', ticketNo: 'TCK-TEST', ticketStatus: 'กำลังดำเนินการ',
    template: { id: 'template-test', code: 'IT-ERP-ISSUE', name: 'แบบฟอร์มทดสอบ', version: 1, source: 'template', updatedAt: '2026-10-19T02:00:00Z' },
    issueForm: null, pageSettings: { size: 'A4', orientation: 'portrait', marginMm: 20 },
    contentHtml: '<h1>แบบฟอร์มแจ้งปัญหา</h1><p>ข้อมูลทดสอบสำหรับตรวจการจัดหน้า</p><table><tbody><tr><th>รายการ</th><th>รายละเอียด</th></tr><tr><td>เครื่องพิมพ์</td><td>ตรวจสอบการเชื่อมต่อ</td></tr></tbody></table><div class="form-page-break"></div><h2>การรับรองผลการดำเนินงาน</h2><p>ผู้รับรอง: ผู้ใช้งานทดสอบ</p><p>ลายเซ็น ....................................</p>',
    checkmarks: [], textValues: {}, canEditCheckmarks: false, canEditContent: false, isCustomized: false, flow: [],
  } } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/tickets/ticket-1/form');
  const sheets = page.getByTestId('ticket-form-sheet');
  await expect(sheets).toHaveCount(2);
  const before = await sheets.first().evaluate(el => ({
    font: getComputedStyle(el).fontFamily,
    size: getComputedStyle(el).fontSize,
    headingFont: getComputedStyle(el.querySelector('h1')!).fontFamily,
    headingSize: getComputedStyle(el.querySelector('h1')!).fontSize,
  }));
  expect(before.font).toContain('TH Sarabun New');
  expect(before.headingFont).toContain('TH Sarabun New');
  await page.getByRole('button', { name: 'เพิ่มขนาดตัวอักษร', exact: true }).click();
  await page.getByRole('button', { name: 'เพิ่มขนาดตัวอักษร', exact: true }).click();
  await expect(sheets).toHaveCount(2);
  expect(await sheets.first().evaluate(el => getComputedStyle(el).fontSize)).toBe(before.size);
  expect(await sheets.first().locator('h1').evaluate(el => getComputedStyle(el).fontSize)).toBe(before.headingSize);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#app-sidebar')).toHaveCSS('display', 'none');
  await expect(page.locator('#main-content')).toHaveCSS('padding', '0px');
  await expect(sheets.last().getByText('ผู้รับรอง: ผู้ใช้งานทดสอบ')).toBeVisible();
  const bytes = await page.pdf({ path: testInfo.outputPath('ticket-a4.pdf'), preferCSSPageSize: true, printBackground: true });
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(2);
  expect(Math.round(pdf.getPage(0).getWidth())).toBe(595);
  await page.screenshot({ path: testInfo.outputPath('ticket-print.png'), fullPage: true });
});
