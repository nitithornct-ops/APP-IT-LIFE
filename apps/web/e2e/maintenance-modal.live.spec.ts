import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.skip(process.env.LIVE_E2E !== '1', 'Live Maintenance modal E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const runId = Date.now();
const email = `codex-maintenance-${runId}@example.com`;
const password = `Maintenance21!${runId}Aa`;
const assetCode = `E2E-PM-${runId}`;
const assetName = `Asset ทดสอบ PM ${runId}`;
let service: SupabaseClient;
let userId = '';
let assetId = '';
let planId = '';

function parseEnv(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !line.trimStart().startsWith('#') && line.includes('=')).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('อีเมล', { exact: true }).fill(email);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

async function expectPopupFitsViewport(page: Page, testId: string) {
  const popup = page.getByTestId(testId);
  await expect(popup).toBeVisible();
  const box = await popup.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.width).toBeLessThan(viewport!.width);
  expect(box!.height).toBeLessThan(viewport!.height);
}

test.beforeAll(async () => {
  const vars = parseEnv(resolve(process.cwd(), '../api/.dev.vars'));
  service = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Maintenance Modal E2E' } });
  if (error || !data.user) throw error ?? new Error('create user failed');
  userId = data.user.id;

  const { data: role, error: roleError } = await service.from('roles').select('id').eq('key', 'it_admin').single();
  if (roleError) throw roleError;
  const { error: assignmentError } = await service.from('user_roles').insert({ user_id: userId, role_id: role.id });
  if (assignmentError) throw assignmentError;

  const { data: asset, error: assetError } = await service.from('assets').insert({ asset_code: assetCode, name: assetName, asset_type: 'Endpoint', status: 'พร้อมใช้งาน', created_by: userId }).select('id').single();
  if (assetError) throw assetError;
  assetId = asset.id;

  const planDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: plan, error: planError } = await service.from('maintenance_plans').insert({ asset_id: assetId, plan_date: planDate, recurrence: 'รายเดือน', status: 'วางแผน', checklist_json: [{ text: 'ตรวจสอบสภาพเครื่อง' }], created_by: userId }).select('id').single();
  if (planError) throw planError;
  planId = plan.id;
});

test.afterAll(async () => {
  if (!service) return;
  if (planId) await service.from('maintenance_plans').delete().eq('id', planId);
  if (assetId) await service.from('assets').delete().eq('id', assetId);
  if (userId) {
    await service.from('audit_logs').delete().eq('actor_id', userId);
    await service.from('login_logs').delete().eq('user_id', userId);
    await service.auth.admin.deleteUser(userId);
  }
});

test('PM dashboard and every primary action use bounded popups', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page);
  await page.goto('/maintenance');
  await expect(page.getByRole('heading', { name: 'PM / บำรุงรักษา', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`pm-row-${planId}`)).toBeVisible();
  await page.screenshot({ path: 'test-results/pm-dashboard.png', fullPage: true });

  await page.getByTestId('pm-create-toggle').click();
  await expectPopupFitsViewport(page, 'pm-create-dialog');
  await expect(page.getByTestId('pm-create-asset')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'test-results/pm-create-popup.png', fullPage: false });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: `จัดการแผน ${assetName}`, exact: true }).click();
  await expectPopupFitsViewport(page, `pm-action-dialog-${planId}`);
  await expect(page.getByTestId(`pm-action-start-${planId}`)).toBeVisible();
  await page.screenshot({ path: 'test-results/pm-action-popup.png', fullPage: false });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'วิเคราะห์ผล', exact: true }).click();
  await expectPopupFitsViewport(page, 'pm-analytics-dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'เทมเพลต', exact: true }).click();
  await expectPopupFitsViewport(page, 'pm-template-dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'ส่งออก', exact: true }).click();
  await expectPopupFitsViewport(page, 'pm-export-dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'ปฏิทิน', exact: true }).click();
  await expect(page.getByRole('button', { name: 'เดือนก่อนหน้า', exact: true })).toBeVisible();
});
