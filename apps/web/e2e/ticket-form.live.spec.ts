import { expect, test, type Locator } from '@playwright/test';
import { resolve } from 'node:path';
import { createLiveAccessToken, installLiveSession } from './helpers/liveAuth';

test.skip(process.env.LIVE_TICKET_FORM_E2E !== '1', 'Live Ticket form E2E is opt-in');
test.describe.configure({ mode: 'serial' });

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
  const email = process.env.UAT_ADMIN_EMAIL;
  const sourceTicketId = process.env.UAT_SIGNATURE_SOURCE_TICKET_ID;
  const formTicketId = process.env.UAT_FORM_TICKET_ID;
  if (!email || !sourceTicketId || !formTicketId) throw new Error('UAT email and Ticket IDs are required');

  const auth = { authorization: `Bearer ${await createLiveAccessToken(email)}` };
  const source = await request.get(`http://127.0.0.1:8787/api/v1/tickets/${sourceTicketId}`, { headers: auth });
  expect(source.ok(), await source.text()).toBeTruthy();
  const sourceBody = await source.json() as { data: { signature_url: string | null } };
  if (!sourceBody.data.signature_url) throw new Error('Source Ticket has no signature');

  const formTicket = await request.get(`http://127.0.0.1:8787/api/v1/tickets/${formTicketId}`, { headers: auth });
  expect(formTicket.ok(), await formTicket.text()).toBeTruthy();
  const formTicketBody = await formTicket.json() as { data: { ticket_no: string } };
  const formTicketNo = formTicketBody.data.ticket_no;
  if (!formTicketNo) throw new Error('Form Ticket has no ticket number');

  // ยืม PNG จริงจาก Ticket ที่มีลายเซ็นอยู่แล้ว มาเซ็นให้ใบที่จะพิมพ์ — ไม่มีลายเซ็นกลางให้ตั้งอีกแล้ว
  const signatureResponse = await request.get(sourceBody.data.signature_url);
  const upload = await request.post(`http://127.0.0.1:8787/api/v1/tickets/${formTicketId}/signature`, {
    headers: auth,
    multipart: { file: { name: 'ticket-signature.png', mimeType: 'image/png', buffer: await signatureResponse.body() } },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();

  await installLiveSession(page, email);
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
