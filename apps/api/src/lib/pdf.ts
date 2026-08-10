import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer';

/**
 * PDF tool decision (R-13, resolved 2026-08-10): Cloudflare Browser Rendering — a headless
 * Chromium-as-a-service binding, no external service/API key needed, same account as the rest
 * of the stack. See docs/migration/phase0-risk_register.md R-13 and phase0-migration_roadmap.md
 * § Decision Gates.
 *
 * Not locally testable: Browser Rendering has no Miniflare emulation in the wrangler version
 * this repo pins — `wrangler dev` will throw when MYBROWSER.fetch is called. Verify with
 * `wrangler dev --remote` (hits the real Cloudflare edge) or a live deployment; see
 * docs/migration/phase7-migration-runbook.md.
 */
export async function renderHtmlToPdf(browser: BrowserWorker, html: string): Promise<Uint8Array> {
  const instance = await puppeteer.launch(browser);
  try {
    const page = await instance.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' } });
    return pdf;
  } finally {
    await instance.close();
  }
}
