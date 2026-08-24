import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.skip(process.env.LIVE_REPORT_E2E !== '1', 'Live Report Center E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const apiBase = 'http://localhost:8787/api/v1';
const runId = Date.now();
const password = `Live20!${runId}Aa`;
const emails = {
  admin: `codex-m20-${runId}-admin@example.com`,
  user: `codex-m20-${runId}-user@example.com`,
};
const userIds: string[] = [];
let service: SupabaseClient;
let anonKey = '';
let supabaseUrl = '';

function parseEnv(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !line.trimStart().startsWith('#') && line.includes('=')).map((line) => {
    const index = line.indexOf('='); return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
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
  return data.user.id;
}

async function token(email: string): Promise<string> {
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error('sign in failed');
  return data.session.access_token;
}

async function api<T>(accessToken: string, path: string, init?: RequestInit, expectedStatus = 200): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}`, ...init?.headers } });
  const body = await response.json() as { success: boolean; data?: T; error?: { code: string; message: string } };
  expect(response.status, body.error?.message).toBe(expectedStatus);
  if (!body.success || body.data === undefined) throw new Error(`${body.error?.code}: ${body.error?.message}`);
  return body.data;
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('อีเมล', { exact: true }).fill(email);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

test.beforeAll(async () => {
  const vars = parseEnv(resolve(process.cwd(), '../api/.dev.vars'));
  supabaseUrl = vars.SUPABASE_URL;
  anonKey = vars.SUPABASE_ANON_KEY;
  service = createClient(supabaseUrl, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminId = await createUser(emails.admin, 'it_admin', 'Module 20 Admin');
  await createUser(emails.user, 'user', 'Module 20 User');
  await service.from('tickets').insert({ title: `LIVE20 Report Ticket ${runId}`, requester_id: adminId, description: 'Report Center live test', priority: 'สูง', status: 'ใหม่', due_at: new Date(Date.now() - 86_400_000).toISOString(), created_by: adminId, updated_by: adminId });
});

test.afterAll(async () => {
  if (!service) return;
  await service.from('report_exports').delete().in('actor_id', userIds);
  await service.from('tickets').delete().in('created_by', userIds);
  await service.from('audit_logs').delete().in('actor_id', userIds);
  await service.from('login_logs').delete().in('user_id', userIds);
  for (const id of userIds.reverse()) await service.auth.admin.deleteUser(id);
});

test('live API returns every standard report, enforces RBAC and records exports', async () => {
  const adminToken = await token(emails.admin);
  const userToken = await token(emails.user);
  const overview = await api<{ definitions: Array<{ key: string }> }>(adminToken, '/reports?rangeDays=30');
  expect(overview.definitions.map((item) => item.key)).toEqual([
    'service-desk', 'requests-workflows', 'assets-operations', 'asset-custody', 'security-resilience', 'governance-compliance',
  ]);
  for (const definition of overview.definitions) {
    const report = await api<{ definition: { key: string }; rows: unknown[] }>(adminToken, `/reports/${definition.key}?rangeDays=30`);
    expect(report.definition.key).toBe(definition.key);
    expect(Array.isArray(report.rows)).toBe(true);
  }
  const csv = await api<{ filename: string; csv: string }>(adminToken, '/reports/service-desk/exports/csv', { method: 'POST', body: JSON.stringify({ rangeDays: 30 }) });
  expect(csv.filename).toMatch(/^service-desk-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csv.csv).toContain(`LIVE20 Report Ticket ${runId}`);
  await api(adminToken, '/reports/service-desk/exports/print', { method: 'POST', body: JSON.stringify({ rangeDays: 30 }) });
  const denied = await fetch(`${apiBase}/reports`, { headers: { authorization: `Bearer ${userToken}` } });
  expect(denied.status).toBe(403);
});

test('admin UI renders report controls, data and all report tabs', async ({ page }) => {
  await login(page, emails.admin);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Report Center', exact: true })).toBeVisible({ timeout: 20_000 });
  for (const tab of ['Service Desk', 'Requests & Workflows', 'Assets & Operations', 'ทะเบียนคุมทรัพย์สินรายพนักงาน', 'Security & Resilience', 'Governance & Compliance']) {
    await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
  }
  await expect(page.getByText(`LIVE20 Report Ticket ${runId}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeVisible();
  // ปุ่มพิมพ์กับดาวน์โหลด PDF ถูกแยกเป็นสองปุ่มตอน refactor — ผูกกับ data-testid ไม่ใช่ข้อความบนปุ่ม
  await expect(page.getByTestId('report-print')).toBeVisible();
  await expect(page.getByTestId('report-pdf')).toBeVisible();
  await page.screenshot({ path: 'test-results/module20-report-center-admin.png', fullPage: true });
});

test('regular employee is denied the Report Center route', async ({ page }) => {
  await login(page, emails.user);
  await page.goto('/reports');
  await expect(page.getByTestId('report-center-page')).toHaveCount(0);
  await expect(page.getByText('ท่านไม่มีสิทธิ์เข้าถึงหน้านี้', { exact: true })).toBeVisible({ timeout: 20_000 });
});
