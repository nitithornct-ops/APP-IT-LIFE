import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLiveAccessToken, installLiveSession } from './helpers/liveAuth';

test.skip(process.env.LIVE_SETTINGS_E2E !== '1', 'Live Settings/Audit E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const apiBase = 'http://127.0.0.1:8787/api/v1';
const runId = Date.now();
const password = `Live22!${runId}Aa`;
const emails = {
  admin: `codex-m22-${runId}-admin@example.com`,
  auditor: `codex-m22-${runId}-auditor@example.com`,
  user: `codex-m22-${runId}-user@example.com`,
};
const userIds: string[] = [];
let service: SupabaseClient;
let originalOrgName = '';

function parseEnv(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !line.trimStart().startsWith('#') && line.includes('=')).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}

async function createUser(email: string, role: string, name: string) {
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !data.user) throw error ?? new Error('create user failed');
  userIds.push(data.user.id);
  const { data: roleRow, error: roleError } = await service.from('roles').select('id').eq('key', role).single();
  if (roleError) throw roleError;
  const { error: assignError } = await service.from('user_roles').insert({ user_id: data.user.id, role_id: roleRow.id });
  if (assignError) throw assignError;
}

async function token(email: string): Promise<string> {
  return createLiveAccessToken(email);
}

async function request(accessToken: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init.headers },
  });
  return { status: response.status, body: await response.json() as { success: boolean; data?: unknown; error?: { code: string; message: string } } };
}

async function login(page: Page, email: string) {
  await installLiveSession(page, email);
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

test.beforeAll(async () => {
  const vars = parseEnv(resolve(process.cwd(), '../api/.dev.vars'));
  service = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: setting, error: settingError } = await service.from('system_settings').select('value').eq('key', 'ORG_NAME').single();
  if (settingError) throw settingError;
  originalOrgName = setting.value;
  await createUser(emails.admin, 'it_admin', 'Module 22 Admin');
  await createUser(emails.auditor, 'auditor', 'Module 22 Auditor');
  await createUser(emails.user, 'user', 'Module 22 User');
});

test.afterAll(async () => {
  if (!service) return;
  const restore = await service.from('system_settings').update({ value: originalOrgName, updated_by: null }).eq('key', 'ORG_NAME');
  const auditCleanup = await service.from('audit_logs').delete().in('actor_id', userIds);
  const loginCleanup = await service.from('login_logs').delete().in('email_attempted', Object.values(emails));
  if (restore.error || auditCleanup.error || loginCleanup.error) throw restore.error ?? auditCleanup.error ?? loginCleanup.error;
  for (const id of userIds.reverse()) {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  const [setting, auditRows, loginRows, authUsers] = await Promise.all([
    service.from('system_settings').select('value').eq('key', 'ORG_NAME').single(),
    service.from('audit_logs').select('id', { count: 'exact', head: true }).in('actor_id', userIds),
    service.from('login_logs').select('id', { count: 'exact', head: true }).in('email_attempted', Object.values(emails)),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (setting.error || auditRows.error || loginRows.error || authUsers.error) throw setting.error ?? auditRows.error ?? loginRows.error ?? authUsers.error;
  if (setting.data.value !== originalOrgName || auditRows.count !== 0 || loginRows.count !== 0 || authUsers.data.users.some((user) => Object.values(emails).includes(user.email ?? ''))) {
    throw new Error('Module 22 live cleanup verification failed');
  }
});

test('live API enforces Settings and Audit role boundaries', async () => {
  const adminToken = await token(emails.admin);
  const auditorToken = await token(emails.auditor);
  const userToken = await token(emails.user);

  const settings = await request(adminToken, '/settings');
  expect(settings.status).toBe(200);
  const settingsData = settings.body.data as { settings: Array<{ key: string }>; notices: { secretsStoredHere: boolean } };
  const settingKeys = settingsData.settings.map((setting) => setting.key);
  expect(settingKeys).toEqual(expect.arrayContaining(['ORG_NAME', 'ORG_LOGO_URL']));
  // Shared staging may be one migration behind a PR. Migration tests own the
  // exact key set; this live test verifies API shape, uniqueness and RBAC.
  expect(new Set(settingKeys).size).toBe(settingKeys.length);
  expect(settingsData.settings.length).toBeGreaterThanOrEqual(51);
  expect(settingsData.notices.secretsStoredHere).toBe(false);

  const update = await request(adminToken, '/settings/ORG_NAME', { method: 'PATCH', body: JSON.stringify({ value: `LIFE Module 22 API ${runId}` }) });
  expect(update.status, update.body.error?.message).toBe(200);
  expect(await request(adminToken, '/settings/NOTIFY_LINE_ENABLED', { method: 'PATCH', body: JSON.stringify({ value: 'true' }) })).toMatchObject({ status: 409 });
  expect(await request(adminToken, '/settings/NOTIFY_LEAD_DAYS', { method: 'PATCH', body: JSON.stringify({ value: '0' }) })).toMatchObject({ status: 400 });

  const audit = await request(adminToken, `/audit-logs?action=UPDATE_SETTING&actor=${encodeURIComponent(emails.admin)}`);
  expect(audit.status).toBe(200);
  expect((audit.body.data as { items: Array<{ target_id: string }> }).items.some((item) => item.target_id === 'ORG_NAME')).toBe(true);
  expect((await request(adminToken, '/audit-logs/login-logs')).status).toBe(200);

  expect((await request(auditorToken, '/audit-logs')).status).toBe(200);
  expect((await request(auditorToken, '/settings')).status).toBe(403);
  expect((await request(userToken, '/audit-logs')).status).toBe(403);
  expect((await request(userToken, '/settings')).status).toBe(403);
});

test('administrator can view and safely edit an allowlisted setting', async ({ page }) => {
  await login(page, emails.admin);
  await page.goto('/admin/settings');
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('หน้านี้ไม่เก็บหรือแสดง Secret', { exact: true })).toBeVisible();
  await expect(page.getByText('ค่าตั้งค่าทั้งหมด', { exact: true }).locator('..').locator('p').first()).toHaveText(/^\d+$/);
  const orgName = page.getByLabel('ORG_NAME', { exact: true });
  await orgName.fill(`LIFE Module 22 UI ${runId}`);
  await page.getByRole('button', { name: 'บันทึก ORG_NAME', exact: true }).click();
  await expect(page.getByText('บันทึก ORG_NAME เรียบร้อย', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/module22-settings-admin.png', fullPage: true });
});

test('auditor can inspect Audit Trail and Login History without Settings access', async ({ page }) => {
  await login(page, emails.auditor);
  await page.goto('/admin/audit-logs');
  await expect(page.getByTestId('audit-log-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Audit Trail', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Login History', exact: true }).click();
  await expect(page.getByText(emails.auditor, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'System Settings', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/module22-audit-login.png', fullPage: true });
});
