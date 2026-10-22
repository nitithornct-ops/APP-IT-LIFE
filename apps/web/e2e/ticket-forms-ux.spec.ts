import { expect, test } from '@playwright/test';
import { installTicketUxFixture } from './helpers/ticketUxFixture';

const template = {
  id: 'template-1', template_code: 'IT-ERP-ISSUE', name: 'ใบรายงานการแจ้งซ่อม',
  category: 'IT Support', module_key: 'ticket', status: 'Published', current_version: 2,
  field_schema: [], content_html: '<h1>ใบรายงานการแจ้งซ่อม</h1><p>{{ticket_no}}</p>',
  page_settings: {}, updated_at: '2026-10-22T03:00:00Z',
};

for (const width of [390, 1440]) {
  test.describe(`Ticket form UX at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test.beforeEach(async ({ page }) => {
      await installTicketUxFixture(page);
      await page.route('**/api/v1/auth/me', async (route) => route.fulfill({ json: { success: true, data: {
        profile: { id: 'staff-1', full_name: 'เจ้าหน้าที่ IT', status: 'active' }, roles: [],
        permissions: ['ticket.view', 'ticket.update', 'ticket.view_all', 'form.view', 'form.manage', 'form.export'],
      } } }));
      await page.route('**/api/v1/forms/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const data = path.endsWith('/templates') ? [template] : path.endsWith('/references') ? { tickets: [], vendors: [] } : [];
        await route.fulfill({ json: { success: true, data } });
      });
      await page.route('**/api/v1/tickets/ticket-1/form-document', async (route) => route.fulfill({ json: { success: true, data: {
        ticketId: 'ticket-1', ticketNo: 'TCK-001', ticketStatus: 'กำลังดำเนินการ',
        template: { id: 'template-1', code: 'IT-ERP-ISSUE', name: template.name, version: 2, source: 'template', updatedAt: template.updated_at },
        issueForm: null, pageSettings: { size: 'A4', orientation: 'portrait', marginMm: 20 },
        contentHtml: '<h1>ใบรายงานการแจ้งซ่อม</h1><p>TCK-001 · ผู้แจ้ง สมชาย</p><h2>อาการที่แจ้ง</h2><p>เครื่องพิมพ์ไม่ทำงาน</p>',
        checkmarks: [], textValues: {}, canEditCheckmarks: false, canEditContent: true, isCustomized: false,
        flow: [1, 2, 3, 4, 5].map((section) => ({ section, title: `ส่วนที่ ${section}`, state: section < 3 ? 'complete' : 'not_required', detail: section < 3 ? 'ข้อมูลจาก Ticket' : 'ไม่เกี่ยวข้องกับงานนี้' })),
      } } }));
    });

    test('separates field, print, governance and version editing', async ({ page }, testInfo) => {
      await page.goto('/forms?template=template-1');
      await expect(page.getByTestId('field-schema-builder')).toBeVisible();
      await page.getByRole('button', { name: 'การตรวจรับและเลขเอกสาร', exact: true }).click();
      await expect(page.getByTestId('template-governance-panel')).toBeVisible();
      await page.getByRole('button', { name: 'ประวัติเวอร์ชัน', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Compare Version' })).toBeVisible();
      await page.getByRole('button', { name: 'รูปแบบพิมพ์', exact: true }).click();
      await expect(page.getByRole('button', { name: 'แทรกตัวแปรฟิลด์' })).toBeVisible();
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(size.content).toBeLessThanOrEqual(size.width);
      await page.screenshot({ path: testInfo.outputPath(`ticket-template-${width}.png`), fullPage: true });
    });

    test('previews a report from the Ticket and explains its source', async ({ page }, testInfo) => {
      await page.goto('/tickets/ticket-1/form');
      await expect(page.getByText('รายงานเชื่อมกับข้อมูล Ticket อัตโนมัติ')).toBeVisible();
      await expect(page.getByTestId('ticket-form-page')).toContainText('TCK-001');
      await expect(page.getByRole('button', { name: 'พิมพ์ / บันทึก PDF', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`ticket-report-${width}.png`), fullPage: true });
    });
  });
}
