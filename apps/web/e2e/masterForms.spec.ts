import { expect, test } from '@playwright/test';
import { loadEnv } from 'vite';

// CI ไม่มีไฟล์ .env ให้ loadEnv อ่าน (มีแต่ .env.local ของเครื่อง dev ซึ่ง gitignore ไว้) ค่านี้จึงต้องมี
// ตัวสำรอง ไม่อย่างนั้น new URL(undefined) จะโยน TypeError ทิ้งทั้ง test ตั้งแต่บรรทัดแรก
// ใช้ค่าเดียวกับที่ขั้นตอน Build ใน .github/workflows/pr.yml ส่งให้ เพื่อให้ชื่อคีย์ session ที่ test
// เขียนลง sessionStorage ตรงกับที่หน้าเว็บซึ่ง build ด้วยค่านั้นอ่านจริง
const SUPABASE_URL_FALLBACK = 'http://localhost:54321';

test('master forms show their purpose and download a blank Word form', async ({ page }, testInfo) => {
  const env = loadEnv('production', process.cwd());
  const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || SUPABASE_URL_FALLBACK;
  const project = new URL(supabaseUrl).hostname.split('.')[0];
  await page.addInitScript(({ key }) => {
    sessionStorage.setItem(key, JSON.stringify({
      access_token: 'local-ui-fixture', refresh_token: 'local-ui-fixture', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'fixture-user', email: 'fixture@example.com', app_metadata: {}, user_metadata: {} },
    }));
  }, { key: `sb-${project}-auth-token` });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/mfa-policy')) data = { required: false };
    else if (path.endsWith('/auth/me')) data = {
      profile: { id: 'fixture-user', full_name: 'ผู้ดูแลแบบฟอร์ม', email: 'fixture@example.com', status: 'active', onboarding_completed_at: '2026-09-01' },
      roles: [], permissions: ['form.view', 'form.manage'],
    };
    else if (path.endsWith('/forms/templates')) data = ['IT-ERP-ISSUE', 'ASSET-BORROW'].map((code, i) => ({
      id: `template-${i}`, template_code: code, name: i ? 'แบบฟอร์มการขอยืมทรัพย์สิน' : 'แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP',
      category: i ? 'ทรัพย์สิน' : 'IT Support / ERP', status: 'Published', current_version: 1,
      description: 'แบบฟอร์มมาตรฐานสำหรับใช้งานร่วมกัน', content_html: '<h1>แบบฟอร์ม</h1><p>{{document_no}}</p>',
      page_settings: {}, updated_at: '2026-09-01T00:00:00Z',
    }));
    else if (path.endsWith('/forms/references')) data = { tickets: [], vendors: [] };
    await route.fulfill({ json: { success: true, data, requestId: 'fixture' } });
  });
  await page.goto('/forms');
  await expect(page.getByText('แบบฟอร์มหลัก · งานแจ้งซ่อม / Ticket ทั้งหมด')).toBeVisible();
  await expect(page.getByText('แบบฟอร์มหลัก · การขอยืมทรัพย์สิน')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ดาวน์โหลดแม่แบบ Word' }).first().click();
  expect((await downloadPromise).suggestedFilename()).toBe('IT-ERP-ISSUE.doc');
  await page.screenshot({ path: testInfo.outputPath('master-forms-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'ดาวน์โหลดแม่แบบ Word' }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('master-forms-mobile.png'), fullPage: true, animations: 'disabled' });
});
