import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

const PROFILE_ID = '00000000-0000-0000-0000-000000004001';
const PROFILE_TWO_ID = '00000000-0000-0000-0000-000000004002';
const EMPLOYEE_ID = '00000000-0000-0000-0000-000000004101';
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users(id, email) values ($1, 'line-governance-1@test.local'), ($2, 'line-governance-2@test.local')`, [PROFILE_ID, PROFILE_TWO_ID]);
    await db.query(`insert into public.employees(id, employee_code, first_name_th, last_name_th) values ($1, 'EMP-LINE-GOV-1', 'ทดสอบ', 'LINE')`, [EMPLOYEE_ID]);
    await db.query(`update public.profiles set employee_id = $1 where id = $2`, [EMPLOYEE_ID, PROFILE_TWO_ID]);
  });
});

afterAll(async () => { await db.close(); });

describe('LINE account governance', () => {
  it('prevents case-variant duplicates of a LINE User ID', async () => {
    await asServiceRole(db, async () => {
      await db.query(`insert into public.line_users(line_user_id, link_status) values ('UCaseSensitiveGovernance0000000001', 'Active')`);
      await expect(db.query(
        `insert into public.line_users(line_user_id, link_status) values ('ucasesensitivegovernance0000000001', 'Active')`,
      )).rejects.toThrow();
    });
  });

  it('records consented links and immutable unlink history', async () => {
    const lineUser = await asServiceRole(db, async () => db.query<{ id: string }>(
      `insert into public.line_users(line_user_id, link_status) values ('UGovernanceHistory0000000000001', 'Active') returning id`,
    ));
    const id = lineUser.rows[0]!.id;
    await asServiceRole(db, async () => {
      await db.query(
        `update public.line_users set linked_user_id = $1, linked_at = now(), link_consent_version = 'line-account-link-v1', link_consent_at = now(), updated_by = $1 where id = $2`,
        [PROFILE_ID, id],
      );
      await db.query(
        `update public.line_users set linked_user_id = null, unlinked_at = now(), unlinked_reason = 'self_unlinked', updated_by = $1 where id = $2`,
        [PROFILE_ID, id],
      );
    });
    const events = await asServiceRole(db, async () => db.query<{ event_type: string; actor_type: string; consent_acknowledged: boolean }>(
      `select event_type, actor_type, consent_acknowledged from public.line_link_events where line_user_id = $1 order by created_at`, [id],
    ));
    expect(events.rows).toEqual([
      { event_type: 'LINKED', actor_type: 'self', consent_acknowledged: true },
      { event_type: 'UNLINKED', actor_type: 'self', consent_acknowledged: true },
    ]);
    await expect(asServiceRole(db, async () => db.query(
      `delete from public.line_link_events where line_user_id = $1`, [id],
    ))).rejects.toThrow();
  });

  it('automatically unlinks a LINE account when its profile becomes inactive', async () => {
    const lineUser = await asServiceRole(db, async () => db.query<{ id: string }>(
      `insert into public.line_users(line_user_id, link_status, linked_user_id) values ('UProfileLifecycle0000000000001', 'Active', $1) returning id`,
      [PROFILE_ID],
    ));
    const id = lineUser.rows[0]!.id;
    await asServiceRole(db, async () => db.query(`update public.profiles set status = 'inactive' where id = $1`, [PROFILE_ID]));
    const result = await asServiceRole(db, async () => db.query<{ linked_user_id: string | null; unlinked_reason: string; event_type: string }>(
      `select l.linked_user_id, l.unlinked_reason, e.event_type
       from public.line_users l
       join public.line_link_events e on e.line_user_id = l.id
       where l.id = $1 order by e.created_at desc limit 1`, [id],
    ));
    expect(result.rows[0]).toEqual({ linked_user_id: null, unlinked_reason: 'profile_inactive', event_type: 'AUTO_UNLINKED' });
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.line_users(line_user_id, link_status, linked_user_id) values ('UInactiveProfileRejected000001', 'Active', $1)`,
      [PROFILE_ID],
    ))).rejects.toThrow(/inactive profile/i);
  });

  it('automatically unlinks a LINE account when its employee is inactive', async () => {
    const lineUser = await asServiceRole(db, async () => db.query<{ id: string }>(
      `insert into public.line_users(line_user_id, link_status, linked_user_id) values ('UEmployeeLifecycle000000000001', 'Active', $1) returning id`,
      [PROFILE_TWO_ID],
    ));
    const id = lineUser.rows[0]!.id;
    await asServiceRole(db, async () => db.query(`update public.employees set status = 'inactive' where id = $1`, [EMPLOYEE_ID]));
    const result = await asServiceRole(db, async () => db.query<{ linked_user_id: string | null; unlinked_reason: string; event_type: string }>(
      `select l.linked_user_id, l.unlinked_reason, e.event_type
       from public.line_users l
       join public.line_link_events e on e.line_user_id = l.id
       where l.id = $1 order by e.created_at desc limit 1`, [id],
    ));
    expect(result.rows[0]).toEqual({ linked_user_id: null, unlinked_reason: 'employee_terminated', event_type: 'AUTO_UNLINKED' });
    await expect(asServiceRole(db, async () => db.query(
      `insert into public.line_users(line_user_id, link_status, linked_user_id) values ('UInactiveEmployeeRejected00001', 'Active', $1)`,
      [PROFILE_TWO_ID],
    ))).rejects.toThrow(/inactive profile/i);
  });

  it('keeps link history and notification preferences service-role-only', async () => {
    const lineUser = await asServiceRole(db, async () => db.query<{ id: string }>(
      `insert into public.line_users(line_user_id, link_status) values ('UPreferenceGovernance00000001', 'Active') returning id`,
    ));
    await asServiceRole(db, async () => db.query(
      `insert into public.line_notification_preferences(line_user_id, disabled_types) values ($1, ARRAY['ticket_comment'])`,
      [lineUser.rows[0]!.id],
    ));
    const staff = await asUser(db, PROFILE_TWO_ID, async () => db.query(`select count(*)::int as count from public.line_notification_preferences`));
    const anon = await asAnon(db, async () => db.query(`select count(*)::int as count from public.line_link_events`));
    expect(staff.rows).toEqual([{ count: 0 }]);
    expect(anon.rows).toEqual([{ count: 0 }]);
  });
});
