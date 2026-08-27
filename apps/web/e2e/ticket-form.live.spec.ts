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
  const formTicketId = process.env.UAT_FORM_TICKET_ID;
  if (!email || !formTicketId) throw new Error('UAT email and form Ticket ID are required');

  const auth = { authorization: `Bearer ${await createLiveAccessToken(email)}` };
  const formTicket = await request.get(`http://127.0.0.1:8787/api/v1/tickets/${formTicketId}`, { headers: auth });
  expect(formTicket.ok(), await formTicket.text()).toBeTruthy();
  const formTicketBody = await formTicket.json() as { data: { ticket_no: string } };
  const formTicketNo = formTicketBody.data.ticket_no;
  if (!formTicketNo) throw new Error('Form Ticket has no ticket number');

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
