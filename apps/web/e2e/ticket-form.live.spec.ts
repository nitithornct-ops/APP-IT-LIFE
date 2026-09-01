import { expect, test, type Locator } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createLiveAccessToken, installLiveSession, liveSupabaseConfig } from './helpers/liveAuth';

test.skip(process.env.LIVE_TICKET_FORM_E2E !== '1', 'Live Ticket form E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const runId = Date.now();
const adminEmail = `codex-ticket-form-${runId}@example.com`;
const adminPassword = `TicketForm21!${runId}Aa`;
let service: SupabaseClient;
let formTicketId = '';
let formTicketNo = '';
let adminUserId = '';

test.beforeAll(async () => {
  const { supabaseUrl, serviceRoleKey } = liveSupabaseConfig();
  service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: adminUser, error: adminError } = await service.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: 'Ticket Form E2E Admin' },
  });
  if (adminError || !adminUser.user) throw adminError ?? new Error('Could not create Ticket form admin');
  adminUserId = adminUser.user.id;
  const { data: adminRole, error: adminRoleError } = await service.from('roles').select('id').eq('key', 'it_admin').single();
  if (adminRoleError || !adminRole) throw adminRoleError ?? new Error('Could not find it_admin role');
  const { error: assignmentError } = await service.from('user_roles').insert({ user_id: adminUserId, role_id: adminRole.id });
  if (assignmentError) throw assignmentError;
  const { data: category, error: categoryError } = await service
    .from('ticket_categories')
    .select('id')
    .eq('status', 'active')
    .limit(1)
    .single();
  if (categoryError) throw categoryError;

  const trackingHash = createHash('sha256').update(`ticket-form-${runId}`).digest('hex');
  const { data: ticket, error: ticketError } = await service
    .from('tickets')
    .insert({
      title: `E2E Ticket form ${runId}`,
      description: 'Self-contained staging fixture for the automatic Ticket form',
      category_id: category.id,
      priority: 'ปานกลาง',
      status: 'ใหม่',
      source_channel: 'guest',
      guest_name: 'E2E Ticket Form',
      public_tracking_token_hash: trackingHash,
    })
    .select('id, ticket_no')
    .single();
  if (ticketError || !ticket) throw ticketError ?? new Error('Could not create Ticket form fixture');
  formTicketId = ticket.id;
  formTicketNo = ticket.ticket_no;
});

test.afterAll(async () => {
  if (!service || !formTicketId) return;
  const { data: ticket } = await service
    .from('tickets')
    .select('signature_storage_path')
    .eq('id', formTicketId)
    .maybeSingle();
  if (ticket?.signature_storage_path) {
    await service.storage.from('ticket-signatures').remove([String(ticket.signature_storage_path)]);
  }
  await service.from('tickets').delete().eq('id', formTicketId);
  if (adminUserId) {
    await service.from('audit_logs').delete().eq('actor_id', adminUserId);
    await service.from('login_logs').delete().eq('user_id', adminUserId);
    await service.auth.admin.deleteUser(adminUserId);
  }
});

async function expectImageLoaded(image: Locator) {
  await expect(image).toHaveAttribute('src', /^https:\/\//, { timeout: 20_000 });
  await expect.poll(
    () => image.evaluate((node) => {
      const element = node as HTMLImageElement;
      return element.complete && element.naturalWidth > 0;
    }),
    { timeout: 20_000, message: 'signature image should finish loading' },
  ).toBe(true);
  await expect(image).toBeVisible();
}

test('signs one Ticket and shows that signature on its automatic form', async ({ page, request }) => {
  const auth = { authorization: `Bearer ${await createLiveAccessToken(adminEmail)}` };
  // A self-contained valid 1x1 PNG keeps this release gate independent from
  // another mutable Ticket fixture while exercising the real upload path.
  const signatureBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const upload = await request.post(`http://127.0.0.1:8787/api/v1/tickets/${formTicketId}/signature`, {
    headers: auth,
    multipart: { file: { name: 'ticket-signature.png', mimeType: 'image/png', buffer: signatureBuffer } },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();

  await installLiveSession(page, adminEmail);
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });

  await page.goto(`/tickets/${formTicketId}`);
  await expectImageLoaded(page.getByTestId('ticket-signature-panel').locator('img'));
  await page.screenshot({ path: resolve(process.cwd(), '../../test-results/ticket-form-per-ticket-signature.png'), fullPage: true });

  await page.goto('/tickets');
  const row = page.locator('tr', { hasText: formTicketNo });
  await expect(row).toBeVisible();
  await expect(row.getByRole('link', { name: /ดูแบบฟอร์ม/ })).toBeVisible();
  await page.screenshot({ path: resolve(process.cwd(), '../../test-results/ticket-form-list-action.png'), fullPage: true });

  await page.goto(`/tickets/${formTicketId}/form`);
  await expect(page.getByTestId('ticket-form-page')).toContainText(formTicketNo);
  await expectImageLoaded(page.getByAltText('ลายเซ็นรับรอง Ticket'));
  await page.screenshot({ path: resolve(process.cwd(), '../../test-results/ticket-form-automatic-preview.png'), fullPage: true });
});
