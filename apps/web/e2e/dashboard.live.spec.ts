import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.skip(process.env.LIVE_DASHBOARD_E2E !== '1', 'Live Dashboard E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const apiBase = 'http://localhost:8787/api/v1';
const runId = Date.now();
const password = `Live21!${runId}Aa`;
const emails = {
  admin: `codex-m21-${runId}-admin@example.com`,
  dpo: `codex-m21-${runId}-dpo@example.com`,
  user: `codex-m21-${runId}-user@example.com`,
};
const userIds: string[] = [];
let service: SupabaseClient;
let anonKey = '';
let supabaseUrl = '';
let adminTicketTitle = '';
let userTicketTitle = '';

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

async function api<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await response.json() as { success: boolean; data?: T; error?: { code: string; message: string } };
  expect(response.status, body.error?.message).toBe(200);
  if (!body.success || body.data === undefined) throw new Error(`${body.error?.code}: ${body.error?.message}`);
  return body.data;
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('อีเมล', { exact: true }).fill(email);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 20_000 });
}

test.beforeAll(async () => {
  const vars = parseEnv(resolve(process.cwd(), '../api/.dev.vars'));
  supabaseUrl = vars.SUPABASE_URL;
  anonKey = vars.SUPABASE_ANON_KEY;
  service = createClient(supabaseUrl, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminId = await createUser(emails.admin, 'it_admin', 'Module 21 Admin');
  await createUser(emails.dpo, 'dpo', 'Module 21 DPO');
  const userId = await createUser(emails.user, 'user', 'Module 21 User');

  adminTicketTitle = `LIVE21 Admin overdue ${runId}`;
  userTicketTitle = `LIVE21 User upcoming ${runId}`;
  const { error: ticketError } = await service.from('tickets').insert([
    { title: adminTicketTitle, requester_id: adminId, description: 'Dashboard admin record', priority: 'วิกฤต', status: 'ใหม่', due_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), created_by: adminId, updated_by: adminId },
    { title: userTicketTitle, requester_id: userId, description: 'Dashboard personal record', priority: 'ปานกลาง', status: 'ใหม่', due_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), created_by: userId, updated_by: userId },
  ]);
  if (ticketError) throw ticketError;

  const { error: taskError } = await service.from('personal_tasks').insert({ owner_id: userId, title: `LIVE21 Personal task ${runId}`, priority: 'เร่งด่วน', status: 'ต้องทำ', due_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), created_by: userId, updated_by: userId });
  if (taskError) throw taskError;

  const { error: incidentError } = await service.from('incidents').insert({
    incident_number: `INC-LIVE21-${runId}`, title: `LIVE21 PII incident ${runId}`, reported_by: adminId,
    category: 'ข้อมูลรั่วไหล', severity: 'วิกฤต', likelihood: 5, impact: 5, description: 'Dashboard privacy test',
    contains_personal_data: true, dpo_notify_deadline: new Date(Date.now() - 86_400_000).toISOString(), status: 'เปิด',
    created_by: adminId, updated_by: adminId,
  });
  if (incidentError) throw incidentError;
});

test.afterAll(async () => {
  if (!service) return;
  await service.from('incidents').delete().in('created_by', userIds);
  await service.from('personal_tasks').delete().in('owner_id', userIds);
  await service.from('tickets').delete().in('created_by', userIds);
  await service.from('audit_logs').delete().in('actor_id', userIds);
  await service.from('login_logs').delete().in('user_id', userIds);
  for (const id of userIds.reverse()) await service.auth.admin.deleteUser(id);
});

test('live API returns role-aware and RLS-aware dashboard summaries', async () => {
  const adminSummary = await api<{ mode: string; cards: Array<{ key: string; overdue: number }>; upcoming: Array<{ title: string }> }>(await token(emails.admin), '/dashboard/summary?leadDays=30');
  expect(adminSummary.mode).toBe('operations');
  expect(adminSummary.cards.length).toBeGreaterThanOrEqual(10);
  expect(adminSummary.cards.find((card) => card.key === 'tickets')?.overdue).toBeGreaterThan(0);
  expect(adminSummary.upcoming.some((item) => item.title === adminTicketTitle)).toBe(true);

  const dpoSummary = await api<{ mode: string; metrics: Array<{ label: string }>; upcoming: Array<{ title: string }> }>(await token(emails.dpo), '/dashboard/summary?leadDays=30');
  expect(dpoSummary.mode).toBe('privacy');
  expect(dpoSummary.metrics[0]?.label).toBe('Incident ข้อมูลส่วนบุคคล');
  expect(dpoSummary.upcoming.some((item) => item.title.includes(`LIVE21 PII incident ${runId}`))).toBe(true);

  const userSummary = await api<{ mode: string; upcoming: Array<{ title: string }>; metrics: Array<{ label: string; value: number }> }>(await token(emails.user), '/dashboard/summary?leadDays=30');
  expect(userSummary.mode).toBe('personal');
  expect(userSummary.upcoming.some((item) => item.title === userTicketTitle)).toBe(true);
  expect(userSummary.upcoming.some((item) => item.title === adminTicketTitle)).toBe(false);
  expect(userSummary.metrics.some((metric) => metric.label === 'งานของฉัน' && metric.value >= 1)).toBe(true);
});

test('admin dashboard renders operational cards and urgent data', async ({ page }) => {
  await login(page, emails.admin);
  await expect(page.getByText('ศูนย์ควบคุมงานปฏิบัติการไอที', { exact: true })).toBeVisible();
  await expect(page.getByText('สุขภาพงานควบคุมเชิงปฏิบัติการ', { exact: true })).toBeVisible();
  await expect(page.getByText(adminTicketTitle, { exact: true })).toBeVisible();
  await expect(page.getByLabel('ช่วงเตือนล่วงหน้า')).toHaveValue('30');
  await page.screenshot({ path: 'test-results/module21-dashboard-admin.png', fullPage: true });
});

test('regular user dashboard keeps organizational records out of the personal view', async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, emails.user);
  await expect(page.getByText('งานและคำขอของฉัน', { exact: true })).toBeVisible();
  await expect(page.getByText(userTicketTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(adminTicketTitle, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/module21-dashboard-user.png', fullPage: true });
  await context.close();
});
