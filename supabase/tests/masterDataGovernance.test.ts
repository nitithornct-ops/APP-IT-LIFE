import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, createTestDb } from './testDb';

const ACTOR_ID = '00000000-0000-0000-0000-0000000000d1';
const SOURCE_ID = '60000000-0000-0000-0000-000000000001';
const TARGET_ID = '60000000-0000-0000-0000-000000000002';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email) values ($1, 'master-data@test.local')`,
      [ACTOR_ID],
    );
    await db.query(
      `insert into public.ticket_categories (id, code, name) values
       ($1, 'TC-SOURCE', 'Source Category'), ($2, 'TC-TARGET', 'Target Category')`,
      [SOURCE_ID, TARGET_ID],
    );
    await db.query(
      `insert into public.tickets (title, requester_id, description, category_id)
       values ('Historical ticket', $1, 'Evidence', $2)`,
      [ACTOR_ID, SOURCE_ID],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('master data governance', () => {
  it('moves references and keeps the duplicate as inactive during merge', async () => {
    const result = await asServiceRole(db, async () => db.query<{ result: Record<string, unknown> }>(
      `select public.merge_master_data($1, $2, $3, $4, $5, $6, $7) as result`,
      ['ticket_category', SOURCE_ID, TARGET_ID, ACTOR_ID, 'master-data@test.local', 'Duplicate cleanup', 'master-data-merge-1'],
    ));

    expect(result.rows[0].result).toMatchObject({
      kind: 'ticket_category',
      sourceId: SOURCE_ID,
      targetId: TARGET_ID,
      movedReferences: 1,
      mode: 'inactive',
    });

    const state = await asServiceRole(db, async () => db.query<{ category_id: string; status: string }>(
      `select t.category_id, c.status
       from public.tickets t
       join public.ticket_categories c on c.id = $1
       where t.title = 'Historical ticket'`,
      [SOURCE_ID],
    ));
    expect(state.rows[0]).toEqual({ category_id: TARGET_ID, status: 'inactive' });

    const audit = await asServiceRole(db, async () => db.query<{ action: string; target_id: string }>(
      `select action, target_id from public.audit_logs where request_id = 'master-data-merge-1'`,
    ));
    expect(audit.rows).toEqual([{ action: 'MERGE', target_id: SOURCE_ID }]);
  });
});
