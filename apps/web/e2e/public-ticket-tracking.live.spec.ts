import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.skip(process.env.LIVE_PUBLIC_TRACKING_E2E !== '1', 'Live public Ticket tracking E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const runId = Date.now();
const guestName = `ผู้ทดสอบ ติดตาม ${runId}`;
const requesterPhone = `08${String(runId).slice(-8)}`;
const title = `ทดสอบค้นหาด้วยชื่อ ${runId}`;
const trackingToken = 'ABCD-EFGH-JKLM';
let service: SupabaseClient;
let ticketId = '';
let ticketNo = '';

function parseEnv(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !line.trimStart().startsWith('#') && line.includes('=')).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}

test.beforeAll(async () => {
  const vars = parseEnv(resolve(process.cwd(), '../api/.dev.vars'));
  service = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: category, error: categoryError } = await service.from('ticket_categories').select('id').eq('status', 'active').limit(1).single();
  if (categoryError) throw categoryError;

  const tokenHash = createHash('sha256').update(trackingToken.replaceAll('-', '')).digest('hex');
  const { data: ticket, error } = await service.from('tickets').insert({
    title,
    description: 'ข้อมูลทดสอบสำหรับตรวจหน้าติดตามสถานะ',
    category_id: category.id,
    priority: 'ปานกลาง',
    status: 'ใหม่',
    source_channel: 'guest',
    guest_name: guestName,
    requester_phone: requesterPhone,
    public_tracking_token_hash: tokenHash,
  }).select('id, ticket_no').single();
  if (error || !ticket) throw error ?? new Error('create guest Ticket failed');
  ticketId = ticket.id;
  ticketNo = ticket.ticket_no;

  const { error: worklogError } = await service.from('ticket_worklogs').insert({
    ticket_id: ticketId,
    action: 'เปิด Ticket',
    status_to: 'ใหม่',
    detail: 'ข้อมูลทดสอบหน้าติดตามสถานะ',
    is_public: true,
    actor_label: `ผู้แจ้งผ่านหน้าสาธารณะ: ${guestName}`,
  });
  if (worklogError) throw worklogError;
});

test.afterAll(async () => {
  if (service && ticketId) await service.from('tickets').delete().eq('id', ticketId);
});

test('finds a guest Ticket only with the Ticket number and tracking token', async ({ page }) => {
  await page.goto('/report');
  await page.getByRole('button', { name: 'ติดตามสถานะ', exact: true }).click();

  await expect(page.getByTestId('public-ticket-code-search')).toBeVisible();
  await page.getByLabel('เลข Ticket', { exact: true }).fill(ticketNo);
  await page.getByLabel('รหัสติดตาม', { exact: true }).fill(trackingToken);
  await page.getByRole('button', { name: 'ตรวจสอบสถานะ', exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: resolve(process.cwd(), '../../test-results/public-ticket-search-by-code.png'), fullPage: true });
  await expect(page.getByText('ข้อมูลทดสอบสำหรับตรวจหน้าติดตามสถานะ', { exact: true })).toBeVisible();
});
