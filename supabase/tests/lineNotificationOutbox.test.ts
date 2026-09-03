import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './testDb';

let db: PGlite;

beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db.close(); });

describe('LINE notification outbox fan-out', () => {
  it('adds the delivery switch and trigger to every notification insertion path', async () => {
    const result = await db.query<{ send_line: boolean; trigger_enabled: string }>(`
      select
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'notifications' and column_name = 'send_line'
        ) as send_line,
        coalesce((
          select tgenabled::text from pg_trigger
          where tgrelid = 'public.notifications'::regclass
            and tgname = 'trg_notifications_enqueue_line'
            and not tgisinternal
        ), '') as trigger_enabled
    `);

    expect(result.rows).toEqual([{ send_line: true, trigger_enabled: 'O' }]);
  });

  it('keeps the trigger function unavailable to public API roles', async () => {
    const result = await db.query<{ anon_execute: boolean; authenticated_execute: boolean }>(`
      select
        has_function_privilege('anon', 'public.enqueue_line_notification()', 'execute') as anon_execute,
        has_function_privilege('authenticated', 'public.enqueue_line_notification()', 'execute') as authenticated_execute
    `);

    expect(result.rows).toEqual([{ anon_execute: false, authenticated_execute: false }]);
  });
});
