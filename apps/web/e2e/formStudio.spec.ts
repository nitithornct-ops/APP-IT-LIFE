import { expect, test } from '@playwright/test';

test('Vendor can review the form and fill the response section', async ({ page }, testInfo) => {
  await page.route('**/api/v1/public/forms/token', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'form-id',
          form_no: 'FRM-202608-00001',
          title: 'ระบบ ERP ไม่สามารถบันทึกรายการได้',
          status: 'Sent to Vendor',
          content_html: '<h1 style="text-align:center">แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP</h1><h2>ส่วนที่ 1: ข้อมูลผู้แจ้ง</h2><table><tbody><tr><td><strong>ผู้แจ้ง</strong><br>สมชาย ใจดี</td><td><strong>Ticket</strong><br>TCK-2026-0012</td></tr></tbody></table><h2>ส่วนที่ 2: การประเมินโดย IT</h2><p>ส่งต่อ Vendor เพื่อตรวจสอบ Source Code / Bug</p><h2>ส่วนที่ 3: การแก้ไขโดย Vendor</h2><p>กรุณากรอกข้อมูลในแผงตอบกลับ</p>',
          vendor_due_at: '2026-08-20',
          vendor_response: {},
          vendor_access_expires_at: '2026-08-27T00:00:00.000Z',
          vendor: { id: 'vendor-id', name: 'ERP Solution Co., Ltd.' },
          ticket: { ticket_no: 'TCK-2026-0012', title: 'ERP บันทึกรายการไม่ได้' },
          template: { name: 'แบบฟอร์ม IT / ERP Issue' },
        },
        requestId: 'test-request',
      }),
    });
  });

  await page.goto('/vendor/forms/token');
  await expect(page.getByText('Vendor Response Portal')).toBeVisible();
  await expect(page.getByText('FRM-202608-00001')).toBeVisible();
  await expect(page.getByText('ส่วนตอบกลับโดย Vendor / Outsource')).toBeVisible();
  await expect(page.getByLabel('ประเภทงาน (SLA Category)')).toHaveValue('Minor Case');
  await expect(page.getByRole('button', { name: 'ส่งผลการประเมิน' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('vendor-form-portal.png'), fullPage: true });
});

