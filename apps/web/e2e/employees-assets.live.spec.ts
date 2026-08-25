import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installLiveSession } from './helpers/liveAuth';

test.skip(process.env.LIVE_E2E !== '1', 'Live employee/assets E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const runId = Date.now();
const email = `codex-employees-${runId}@example.com`;
const password = `Employees21!${runId}Aa`;
const employeeCode = `E2E-${runId}`;
const firstName = `ทดสอบ${runId}`;
let service: SupabaseClient;
let userId = '';
let employeeId = '';

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
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Employee Assets E2E' } });
  if (error || !data.user) throw error ?? new Error('create user failed');
  userId = data.user.id;
  const { data: role, error: roleError } = await service.from('roles').select('id').eq('key', 'it_admin').single();
  if (roleError) throw roleError;
  const { error: roleAssignmentError } = await service.from('user_roles').insert({ user_id: userId, role_id: role.id });
  if (roleAssignmentError) throw roleAssignmentError;
  const { data: employee, error: employeeError } = await service.from('employees').insert({ employee_code: employeeCode, first_name_th: firstName, last_name_th: 'พนักงาน', email, created_by: userId }).select('id').single();
  if (employeeError) throw employeeError;
  employeeId = employee.id;
});

test.afterAll(async () => {
  if (!service) return;
  if (employeeId) {
    await service.from('employee_lifecycle_events').delete().eq('employee_id', employeeId);
    await service.from('employee_assignments').delete().eq('employee_id', employeeId);
    await service.from('employees').delete().eq('id', employeeId);
  }
  if (userId) {
    await service.from('audit_logs').delete().eq('actor_id', userId);
    await service.from('login_logs').delete().eq('user_id', userId);
    await service.auth.admin.deleteUser(userId);
  }
});

test('employee register and all action forms render as bounded popups', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await login(page);
  await page.goto('/admin/employees');
  await expect(page.getByRole('heading', { name: 'รายชื่อพนักงานและทรัพย์สินที่ครอบครอง', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(employeeCode, { exact: true })).toBeVisible();
  await page.getByLabel('กรองการครอบครอง').selectOption('without');
  await expect(page.getByText(employeeCode, { exact: true })).toBeVisible();
  await page.getByLabel('กรองการครอบครอง').selectOption('');

  await page.getByTestId('employee-create-toggle').click();
  await expectPopupFitsViewport(page, 'employee-create-dialog');
  await expect(page.getByTestId('employee-code')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: `แก้ไข ${firstName} พนักงาน`, exact: true }).click();
  await expectPopupFitsViewport(page, 'employee-edit-dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: `เพิ่มทรัพย์สิน ${firstName} พนักงาน`, exact: true }).click();
  await expectPopupFitsViewport(page, 'employee-assignment-dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: `Lifecycle ${firstName} พนักงาน`, exact: true }).click();
  await expectPopupFitsViewport(page, 'employee-lifecycle-dialog');
  await page.screenshot({ path: 'test-results/employees-lifecycle-popup.png', fullPage: false });
  await page.keyboard.press('Escape');

  await page.goto('/admin/employee-assignments');
  await expect(page.getByRole('heading', { name: 'เบิกจ่าย / คืนทรัพย์สินพนักงาน', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('การเพิ่มหรือแก้ไขข้อมูลพนักงานและรายการที่มอบหมาย ทำจากหน้า', { exact: false })).toBeVisible();
  await expect(page.getByTestId('ea-create-toggle')).toHaveCount(0);
  await expect(page.getByTestId('ea-go-employees')).toBeVisible();
});
