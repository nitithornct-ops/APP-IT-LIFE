import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

let db: PGlite;
const user = '00000000-0000-4000-8000-000000009101';
const schedule = '00000000-0000-4000-8000-000000009102';
const run = '00000000-0000-4000-8000-000000009103';
const token = '00000000-0000-4000-8000-000000009104';
const newToken = '00000000-0000-4000-8000-000000009105';
const snapshot = JSON.stringify({ report_key: 'service-desk', snapshot_kind: 'scheduled', title: 'Original', filters: {}, dataset: { total: 1 }, generated_at: '2026-11-01T00:00:00Z', created_by: user });
const persist = 'select public.persist_scheduled_report_snapshot($1, $2, $3::jsonb) as id';

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query("insert into auth.users(id,email) values ($1,'schedule-recovery@test.local')", [user]);
    await db.query("insert into public.report_schedules(id,created_by,report_key,name,frequency,day_of_week,next_run_at) values ($1,$2,'service-desk','Recovery','weekly',1,now())", [schedule, user]);
    await db.query("insert into public.report_schedule_runs(id,schedule_id,scheduled_for,status,claim_token,lease_until,recovery_phase) values ($1,$2,now(),'running',$3,now()+interval '30 minutes','preparing')", [run, schedule, token]);
  });
});
afterAll(async () => { await db.close(); });

it('does not write a snapshot after the lease has expired', async () => {
  await asServiceRole(db, () => db.query("update public.report_schedule_runs set lease_until=now()-interval '1 minute' where id=$1", [run]));
  await expect(asServiceRole(db, () => db.query(persist, [run, token, snapshot]))).rejects.toThrow('REPORT_SCHEDULE_LEASE_LOST');
  const state = await asServiceRole(db, () => db.query<{ snapshot_id: string | null }>('select snapshot_id from public.report_schedule_runs where id=$1', [run]));
  expect(state.rows[0].snapshot_id).toBeNull();
  await asServiceRole(db, () => db.query("update public.report_schedule_runs set lease_until=now()+interval '30 minutes' where id=$1", [run]));
});

it('persists one immutable snapshot per run and fences a previous lease holder', async () => {
  const first = await asServiceRole(db, () => db.query<{ id: string }>(persist, [run, token, snapshot]));
  await asServiceRole(db, () => db.query("update public.report_schedule_runs set claim_token=$2, lease_until=now()+interval '30 minutes' where id=$1", [run, newToken]));
  await expect(asServiceRole(db, () => db.query(persist, [run, token, snapshot]))).rejects.toThrow('REPORT_SCHEDULE_LEASE_LOST');
  const retry = await asServiceRole(db, () => db.query<{ id: string }>(persist, [run, newToken, JSON.stringify({ ...JSON.parse(snapshot), title: 'Changed' })]));
  expect(retry.rows[0].id).toBe(first.rows[0].id);
  const saved = await asServiceRole(db, () => db.query<{ title: string }>('select title from public.report_snapshots where id=$1', [first.rows[0].id]));
  expect(saved.rows).toEqual([{ title: 'Original' }]);
});

it('crosses the external upload boundary only once and rejects stale workers', async () => {
  const old = await asServiceRole(db, () => db.query<{ ok: boolean }>('select public.begin_scheduled_report_upload($1,$2) as ok', [run, token]));
  expect(old.rows[0].ok).toBe(false);
  const first = await asServiceRole(db, () => db.query<{ ok: boolean }>('select public.begin_scheduled_report_upload($1,$2) as ok', [run, newToken]));
  const repeat = await asServiceRole(db, () => db.query<{ ok: boolean }>('select public.begin_scheduled_report_upload($1,$2) as ok', [run, newToken]));
  expect(first.rows[0].ok).toBe(true);
  expect(repeat.rows[0].ok).toBe(false);
});

it('keeps recovery RPCs restricted to the service role', async () => {
  await expect(asUser(db, user, () => db.query(persist, [run, newToken, snapshot]))).rejects.toThrow();
  await expect(asUser(db, user, () => db.query('select public.begin_scheduled_report_upload($1,$2)', [run, newToken]))).rejects.toThrow();
});
