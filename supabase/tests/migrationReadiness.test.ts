import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const USER_ID = '00000000-0000-0000-0000-000000002801';
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users(id,email) values ($1,'migration-user@test.local')`, [USER_ID]);
  });
});

afterAll(async () => { await db.close(); });

describe('Phase 7 migration readiness', () => {
  it('adds legacy source and ID columns to every transformed UUID target', async () => {
    const migration = readFileSync(resolve(process.cwd(), 'migrations/20260828100000_migration_readiness.sql'), 'utf8');
    const arrayBody = migration.match(/target_tables text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? '';
    const expected = [...arrayBody.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
    const result = await asServiceRole(db, async () => db.query<{ table_name: string }>(
      `select table_name
       from information_schema.columns
       where table_schema = 'public' and column_name in ('legacy_source','legacy_id')
       group by table_name having count(distinct column_name) = 2`,
    ));
    const prepared = new Set(result.rows.map((row) => row.table_name));
    expect(expected.filter((table) => !prepared.has(table))).toEqual([]);
  });

  it('stores LINE identities but exposes none to authenticated clients', async () => {
    await asServiceRole(db, async () => db.query(
      `insert into public.line_users(legacy_source,legacy_id,line_user_id,display_name)
       values ('LineUsers','LINE-LEGACY-1','line-provider-subject-1','Migration Test')`,
    ));
    const hidden = await asUser(db, USER_ID, async () => db.query(`select count(*)::int as count from public.line_users`));
    expect(hidden.rows).toEqual([{ count: 0 }]);
  });

  it('enforces one target row for each source identity', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.line_users(legacy_source,legacy_id,line_user_id)
       values ('LineUsers','LINE-LEGACY-1','line-provider-subject-2')`,
    ))).rejects.toThrow();
  });

  it('can be applied again without relation or duplicate-trigger errors', async () => {
    const migration = readFileSync(resolve(process.cwd(), 'migrations/20260828100000_migration_readiness.sql'), 'utf8');
    await db.exec(migration);
    const result = await asServiceRole(db, async () => db.query(`select count(*)::int as count from public.line_users`));
    expect(result.rows).toEqual([{ count: 1 }]);
  });
});
