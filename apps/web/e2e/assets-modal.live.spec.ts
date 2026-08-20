import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.skip(process.env.LIVE_E2E !== '1', 'Live Asset modal E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const runId = Date.now();
const email = `codex-assets-modal-${runId}@example.com`;
const password = `AssetModal21!${runId}Aa`;
const assetCode = `E2E-MODAL-${runId}`;
const assetName = `ทรัพย์สินทดสอบ Popup ${runId}`;
let service: SupabaseClient;
let userId = '';
let assetId = '';

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
  await expect(popup).toHaveCSS('opacity', '1');
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
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Asset Modal E2E' } });
  if (error || !data.user) throw error ?? new Error('create user failed');
  userId = data.user.id;

  const { data: role, error: roleError } = await service.from('roles').select('id').eq('key', 'it_admin').single();
  if (roleError) throw roleError;
  const { error: assignmentError } = await service.from('user_roles').insert({ user_id: userId, role_id: role.id });
  if (assignmentError) throw assignmentError;

  const { data: asset, error: assetError } = await service.from('assets').insert({
    asset_code: assetCode,
    name: assetName,
    asset_type: 'Endpoint',
    status: 'พร้อมใช้งาน',
    location: 'ห้องทดสอบ Popup',
    created_by: userId,
  }).select('id').single();
  if (assetError) throw assetError;
  assetId = asset.id;
});

test.afterAll(async () => {
  if (!service) return;
  if (assetId) await service.from('assets').delete().eq('id', assetId);
  if (userId) {
    await service.from('audit_logs').delete().eq('actor_id', userId);
    await service.from('login_logs').delete().eq('user_id', userId);
    await service.auth.admin.deleteUser(userId);
  }
});

test('asset create, edit and action forms open as bounded popups', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await login(page);
  await page.goto('/assets');
  await expect(page.getByRole('heading', { name: 'ทะเบียนทรัพย์สิน IT', exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('asset-create-toggle').click();
  await expectPopupFitsViewport(page, 'asset-create-dialog');
  await expect(page.getByRole('dialog', { name: 'เพิ่มทรัพย์สิน', exact: true })).toBeVisible();
  await expect(page.getByTestId('asset-create-name')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'test-results/assets-create-popup.png', fullPage: false });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('asset-create-dialog')).toBeHidden();

  await page.getByRole('link', { name: assetName, exact: true }).click();
  await expect(page.getByTestId('asset-detail-page')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('asset-detail-edit-toggle').click();
  await expectPopupFitsViewport(page, 'asset-edit-dialog');
  await page.getByTestId('asset-edit-dialog').getByRole('button', { name: 'ปิดหน้าต่าง', exact: true }).click();
  await expect(page.getByTestId('asset-edit-dialog')).toBeHidden();

  await page.getByTestId('asset-action-verify').click();
  await expectPopupFitsViewport(page, 'asset-action-dialog-verify');
  await expect(page.getByRole('dialog', { name: 'ตรวจนับทรัพย์สิน (Stocktake)', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/assets-action-popup.png', fullPage: false });
});
