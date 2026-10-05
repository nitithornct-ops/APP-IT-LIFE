import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createTestDb } from './testDb';

it('publishes a two-sheet reference template and can reapply without a version bump', async () => {
  const db = await createTestDb();
  try {
    const load = () => db.query<{ content_html: string; current_version: number; page_settings: { size: string } }>("select content_html, current_version, page_settings from public.form_templates where template_code = 'IT-ERP-ISSUE'");
    const before = (await load()).rows[0];
    expect(before.content_html.match(/class="ticket-reference-page"/g)).toHaveLength(2);
    expect(before.content_html).toContain('{{image_attachments}}');
    expect(before.page_settings.size).toBe('A4');
    await db.exec(readFileSync(resolve(process.cwd(), 'migrations/20261121100000_ticket_form_two_page_reference.sql'), 'utf8'));
    expect((await load()).rows[0].current_version).toBe(before.current_version);
  } finally {
    await db.close();
  }
}, 120000);
