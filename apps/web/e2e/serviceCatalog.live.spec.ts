import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installLiveSession } from './helpers/liveAuth';

test.skip(process.env.LIVE_E2E !== '1', 'Live Service Catalog E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const runId = Date.now();
const email = `codex-service-catalog-${runId}@example.com`;
const password = `Catalog21!${runId}Aa`;
const serviceCode = `E2E_CATALOG_${runId}`;
let service: SupabaseClient;
let userId = '';
let catalogId = '';

function parseEnv(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !line.trimStart().startsWith('#') && line.includes('=')).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}

async function login(page: Page) {
  await installLiveSession(page, email);
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

test.beforeAll(async () => {
  const vars = parseEnv(resolve(process.cwd(), '../api/.dev.vars'));
  service = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Service Catalog E2E' } });
  if (error || !data.user) throw error ?? new Error('create user failed');
  userId = data.user.id;
  const { data: role, error: roleError } = await service.from('roles').select('id').eq('key', 'it_admin').single();
  if (roleError) throw roleError;
  const { error: assignmentError } = await service.from('user_roles').insert({ user_id: userId, role_id: role.id });
  if (assignmentError) throw assignmentError;
  const { data: catalog, error: catalogError } = await service.from('service_catalog').insert({
    service_code: serviceCode,
    service_name: `บริการทดสอบ Catalog ${runId}`,
    category: 'E2E Services',
    description: 'บริการสำหรับตรวจสอบ workspace แบบ end-to-end',
    sla_hours: 8,
    approval_mode: 'none',
    checklist: [{ name: 'ตรวจสอบข้อมูล', isRequired: true }],
    status: 'active',
    published_at: new Date().toISOString(),
    created_by: userId,
  }).select('id').single();
  if (catalogError) throw catalogError;
  catalogId = catalog.id;
});

test.afterAll(async () => {
  if (!service) return;
  if (catalogId) await service.from('service_catalog').delete().eq('id', catalogId);
  if (userId) {
    await service.from('audit_logs').delete().eq('actor_id', userId);
    await service.from('login_logs').delete().eq('user_id', userId);
    await service.auth.admin.deleteUser(userId);
  }
});

test('workspace matches catalog, request and management flows', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await login(page);
  await page.goto('/service-requests');
  await expect(page.getByRole('heading', { name: 'Service Catalog / คำขอบริการ', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('บริการที่เลือกได้', { exact: true })).toBeVisible();
  const serviceCard = page.getByRole('article').filter({ hasText: serviceCode });
  await expect(serviceCard).toBeVisible();
  await page.screenshot({ path: 'test-results/service-catalog-workspace.png', fullPage: true });

  await serviceCard.getByRole('button', { name: 'ขอรับบริการ', exact: true }).click();
  await expect(page.getByRole('heading', { name: `ขอรับบริการ: บริการทดสอบ Catalog ${runId}`, exact: true })).toBeVisible();
  // หลัง refactor Modal.tsx ปุ่มปิดเป็นไอคอนที่มี aria-label 'ปิดหน้าต่าง' — ใช้ testid ที่ตั้งไว้แทน
  await page.getByTestId('service-request-close').click();

  await page.getByRole('button', { name: 'จัดการ Catalog', exact: true }).click();
  const catalogSearch = page.getByRole('searchbox', { name: 'ค้นหาในตาราง', exact: true });
  await expect(catalogSearch).toBeVisible();
  await catalogSearch.fill(serviceCode);
  await expect(page.getByText(serviceCode, { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/service-catalog-management.png', fullPage: true });

  await page.getByTestId('catalog-manage-create').click();
  await expect(page.getByRole('heading', { name: 'เพิ่มรายการบริการ', exact: true })).toBeVisible();
  await expect(page.getByLabel('รหัสบริการ *')).toBeVisible();
  await expect(page.getByLabel('Checklist (JSON)')).toBeVisible();
  await page.screenshot({ path: 'test-results/service-catalog-editor.png', fullPage: true });
  await page.getByRole('dialog', { name: 'เพิ่มรายการบริการ', exact: true }).getByRole('button', { name: 'ปิดหน้าต่าง', exact: true }).click();
});
