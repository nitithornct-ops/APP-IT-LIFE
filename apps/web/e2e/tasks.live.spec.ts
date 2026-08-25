import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installLiveSession } from './helpers/liveAuth';

test.skip(process.env.LIVE_TASKS_E2E !== '1', 'Live Tasks E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const runId = Date.now();
const email = `codex-tasks-${runId}@example.com`;
const password = `Tasks21!${runId}Aa`;
let service: SupabaseClient;
let userId = '';

function parseEnv(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

test.beforeAll(async () => {
  const vars = parseEnv(resolve(process.cwd(), '../api/.dev.vars'));
  service = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Tasks Visual Test' } });
  if (error || !data.user) throw error ?? new Error('create user failed');
  userId = data.user.id;

  const { data: role } = await service.from('roles').select('id').eq('key', 'user').single();
  await service.from('user_roles').insert({ user_id: userId, role_id: role!.id });

  const date = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const { error: taskError } = await service.from('personal_tasks').insert([
    { owner_id: userId, title: 'ตรวจสอบสัญญาบริการ Cloud', category: 'ติดตาม', priority: 'สูง', status: 'กำลังทำ', progress: 45, due_date: date(2), created_by: userId },
    { owner_id: userId, title: 'จัดทำรายงานความพร้อมประจำเดือน', category: 'เอกสาร', priority: 'ปกติ', status: 'ต้องทำ', progress: 0, due_date: date(6), created_by: userId },
    { owner_id: userId, title: 'ทบทวนรายการสิทธิ์ผู้ใช้งาน', category: 'งานทั่วไป', priority: 'เร่งด่วน', status: 'ต้องทำ', progress: 10, due_date: date(-2), created_by: userId },
  ]);
  if (taskError) throw taskError;
});

test.afterAll(async () => {
  if (!service || !userId) return;
  await service.from('personal_tasks').delete().eq('owner_id', userId);
  await service.from('audit_logs').delete().eq('actor_id', userId);
  await service.from('login_logs').delete().eq('user_id', userId);
  await service.auth.admin.deleteUser(userId);
});

async function login(page: Page) {
  await installLiveSession(page, email);
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'งานของฉัน', exact: true })).toBeVisible({ timeout: 20_000 });
}

test('task command center renders on desktop and switches to calendar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await expect(page.getByRole('article').filter({ hasText: 'ตรวจสอบสัญญาบริการ Cloud' })).toBeVisible();
  await expect(page.getByText('งานที่เปิดอยู่', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/tasks-command-center-desktop.png', fullPage: true });

  await page.getByRole('button', { name: 'สร้างงานใหม่', exact: true }).click();
  await expect(page.getByTestId('task-create-modal')).toBeVisible();
  await expect(page.getByLabel('ชื่องาน', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/tasks-create-modal-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();

  await page.getByRole('button', { name: 'ปฏิทิน', exact: true }).click();
  await expect(page.getByText('เลือกชื่องานเพื่อดูรายละเอียด', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/tasks-calendar-desktop.png', fullPage: true });
});

test('primary task actions call the API and update the interface', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);

  await page.getByRole('button', { name: 'สร้างงานใหม่', exact: true }).click();
  await page.getByLabel('ชื่องาน', { exact: true }).fill('งานทดสอบ Action');
  await page.getByTestId('task-create-draft').click();
  await expect(page.getByTestId('task-create-modal')).toHaveCount(0);
  await expect(page.getByText('งานทดสอบ Action', { exact: true })).toBeVisible();

  const startResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && /\/api\/v1\/tasks\/[^/]+\/status$/.test(new URL(response.url()).pathname)
  ));
  await page.getByLabel('เริ่มงาน จัดทำรายงานความพร้อมประจำเดือน', { exact: true }).click();
  expect((await startResponsePromise).ok()).toBeTruthy();
  const reportCard = page.getByRole('article').filter({ hasText: 'จัดทำรายงานความพร้อมประจำเดือน' });
  await expect(reportCard.getByText('กำลังทำ', { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('แก้ไข จัดทำรายงานความพร้อมประจำเดือน', { exact: true }).click();
  await expect(page.getByTestId('task-detail-panel')).toBeVisible();
  await page.getByLabel('ชื่องาน', { exact: true }).fill('จัดทำรายงานความพร้อมประจำเดือน (แก้ไขแล้ว)');
  await page.getByTestId('td-save').click();
  await page.getByTestId('task-detail-close').click();
  // ชื่องานปรากฏหลายที่พร้อมกัน (การ์ดในรายการ + chip ปฏิทิน) getByText จึงชน strict mode
  // ใช้ปุ่มแก้ไขของการ์ดซึ่งมีชื่องานอยู่ใน aria-label และมีหนึ่งเดียวต่องาน
  await expect(page.getByLabel('แก้ไข จัดทำรายงานความพร้อมประจำเดือน (แก้ไขแล้ว)', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^my-tasks-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.getByLabel('ทำงานเสร็จ งานทดสอบ Action', { exact: true }).click();
  await expect(page.getByText('งานทดสอบ Action', { exact: true })).toHaveCount(0);
});

test('task command center remains contained on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('article').filter({ hasText: 'ตรวจสอบสัญญาบริการ Cloud' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width }))
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 10),
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.offenders, null, 2)).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  await expect(page.getByText('จดงานใหม่ที่นี่...', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'สร้างงานใหม่', exact: true }).click();
  await expect(page.getByTestId('task-create-modal')).toBeVisible();
  await expect(page.getByLabel('ชื่องาน', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/tasks-command-center-mobile.png', fullPage: true });
});
