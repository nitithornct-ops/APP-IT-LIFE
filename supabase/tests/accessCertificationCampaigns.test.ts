import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ADMIN_ID = '00000000-0000-0000-0000-00000000c101';
const REVIEWER_ID = '00000000-0000-0000-0000-00000000c102';
const USER_A_ID = '00000000-0000-0000-0000-00000000c103';
const USER_B_ID = '00000000-0000-0000-0000-00000000c104';
const SYSTEM_ID = '00000000-0000-0000-0000-00000000c105';
const ITEM_ID = '00000000-0000-0000-0000-00000000c106';

let db: PGlite;
let campaignId: string;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email) values
       ($1, 'campaign-admin@test.local'), ($2, 'campaign-reviewer@test.local'),
       ($3, 'campaign-user-a@test.local'), ($4, 'campaign-user-b@test.local')`,
      [ADMIN_ID, REVIEWER_ID, USER_A_ID, USER_B_ID],
    );
    await db.query(
      `insert into public.user_roles(user_id, role_id)
       select $1::uuid, id from public.roles where key = 'super_admin'
       union all
       select $2::uuid, id from public.roles where key = 'manager'`,
      [ADMIN_ID, REVIEWER_ID],
    );
    await db.query(
      `insert into public.access_systems(id, name, status) values ($1, 'Campaign ERP', 'active')`,
      [SYSTEM_ID],
    );
    await db.query(
      `insert into public.access_control_items
       (id, system_id, kind, code, name, permission_actions, data_classification, system_owner_id)
       values ($1, $2, 'role', 'ERP-AP', 'ERP AP Reviewer', array['read','approve'], 'ลับ', $3)`,
      [ITEM_ID, SYSTEM_ID, ADMIN_ID],
    );
    await db.query(
      `insert into public.user_access_registry
       (user_id, system_id, access_item_id, permission_actions, data_classification, granted_by, approved_by)
       values ($1::uuid, $3::uuid, $4::uuid, array['read','approve'], 'ลับ', $2::uuid, $6::uuid),
              ($5::uuid, $3::uuid, $4::uuid, array['read','approve'], 'ลับ', $2::uuid, $6::uuid)`,
      [USER_A_ID, ADMIN_ID, SYSTEM_ID, ITEM_ID, USER_B_ID, REVIEWER_ID],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('access certification campaign', () => {
  it('captures an immutable snapshot, applies bulk decisions, and signs off', async () => {
    const created = await asUser(db, ADMIN_ID, async () => db.query<{ id: string }>(
      `select public.create_access_certification_campaign($1, $2, $3, $4, current_date + 30) as id`,
      ['ERP-ACCESS-2569', 'ทบทวนสิทธิ์ ERP ประจำปี 2569', SYSTEM_ID, REVIEWER_ID],
    ));
    campaignId = created.rows[0].id;

    const evidence = await asServiceRole(db, async () => db.query<{ total: number; entries: unknown[] }>(
      `select jsonb_array_length(evidence_snapshot->'entries') as total,
              evidence_snapshot->'entries' as entries
       from public.access_certification_campaigns where id = $1`,
      [campaignId],
    ));
    expect(evidence.rows[0].total).toBe(2);
    expect(evidence.rows[0].entries).toEqual(expect.arrayContaining([expect.objectContaining({ accessItemCode: 'ERP-AP' })]));

    await asServiceRole(db, async () => db.query(
      `update public.access_certification_campaigns set due_date = current_date - 1 where id = $1`, [campaignId],
    ));
    const escalation = await asUser(db, ADMIN_ID, async () => db.query<{ result: { reviewerId: string } }>(
      `select public.escalate_access_certification_campaign($1, 'ใกล้ปิดรอบ Audit') as result`, [campaignId],
    ));
    expect(escalation.rows[0].result.reviewerId).toBe(REVIEWER_ID);

    const items = await asServiceRole(db, async () => db.query<{ id: string }>(
      `select id from public.access_certification_items where campaign_id = $1 order by id`, [campaignId],
    ));
    const result = await asUser(db, REVIEWER_ID, async () => db.query<{ result: { approvedCount: number; revokedCount: number; pendingCount: number } }>(
      `select public.decide_access_certification_items($1, $2::jsonb) as result`,
      [campaignId, JSON.stringify([
        { item_id: items.rows[0].id, decision_status: 'approved', decision_note: 'ตรงตามหน้าที่' },
        { item_id: items.rows[1].id, decision_status: 'revoked', decision_note: 'ไม่พบความจำเป็นในรอบนี้' },
      ])],
    ));
    expect(result.rows[0].result).toEqual({ campaignId, approvedCount: 1, revokedCount: 1, pendingCount: 0 });

    const registry = await asServiceRole(db, async () => db.query<{ status: string; last_review_date: string | null }>(
      `select status, last_review_date from public.user_access_registry where user_id in ($1, $2) order by user_id`, [USER_A_ID, USER_B_ID],
    ));
    expect(registry.rows.map((row) => row.status).sort()).toEqual(['active', 'revoked']);
    expect(registry.rows.some((row) => row.last_review_date !== null)).toBe(true);

    const signed = await asUser(db, REVIEWER_ID, async () => db.query<{ result: { status: string; pendingCount: number } }>(
      `select public.sign_off_access_certification_campaign($1, 'ผู้ทบทวนรับรองผล') as result`, [campaignId],
    ));
    expect(signed.rows[0].result).toEqual({ campaignId, status: 'completed', pendingCount: 0 });
  });

  it('rejects tampering with the evidence snapshot', async () => {
    await expect(asServiceRole(db, async () => db.query(
      `update public.access_certification_campaigns
       set evidence_snapshot = jsonb_build_object('tampered', true)
       where id = $1`, [campaignId],
    ))).rejects.toThrow(/ACCESS_CERTIFICATION_SNAPSHOT_IMMUTABLE/);
  });
});
