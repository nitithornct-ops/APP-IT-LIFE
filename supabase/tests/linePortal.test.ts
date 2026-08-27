import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

const STAFF_ID = '00000000-0000-0000-0000-000000002301';
let db: PGlite;
let lineUserId: string;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users(id,email) values ($1,'line-portal-staff@test.local')`, [STAFF_ID]);
    await db.query(
      `insert into public.user_roles(user_id,role_id) select $1::uuid, id from public.roles where key = 'technician'`,
      [STAFF_ID],
    );
    const lineUser = await db.query<{ id: string }>(
      `insert into public.line_users(line_user_id, display_name, link_status)
       values ('Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ทดสอบ LINE', 'Active') returning id`,
    );
    lineUserId = lineUser.rows[0]!.id;
  });
});

afterAll(async () => { await db.close(); });

describe('LINE public portal database controls', () => {
  it('rejects an unrecognized link_status but allows the four documented legacy values and null', async () => {
    await asServiceRole(db, async () => {
      await expect(db.query(
        `insert into public.line_users(line_user_id, link_status) values ('Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'NotARealStatus')`,
      )).rejects.toThrow();
      for (const status of ['Pending', 'Active', 'Suspended', 'Unlinked']) {
        const inserted = await db.query<{ link_status: string }>(
          `insert into public.line_users(line_user_id, link_status) values ($1, $2) returning link_status`,
          [`U${status}${'x'.repeat(32 - status.length)}`, status],
        );
        expect(inserted.rows).toEqual([{ link_status: status }]);
      }
    });
  });

  it('keeps line_sessions and line_notification_log service-role-only, like line_users already is', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.line_sessions(session_hash, line_user_id, expires_at) values ('deadbeef', $1, now() + interval '1 day')`,
        [lineUserId],
      );
      await db.query(`insert into public.line_notification_log(line_user_id, to_target, message, success) values ($1, 'U123', 'hi', true)`, [lineUserId]);
    });
    const asStaffSessions = await asUser(db, STAFF_ID, async () => db.query(`select count(*)::int as count from public.line_sessions`));
    const asStaffLog = await asUser(db, STAFF_ID, async () => db.query(`select count(*)::int as count from public.line_notification_log`));
    const asAnonSessions = await asAnon(db, async () => db.query(`select count(*)::int as count from public.line_sessions`));
    expect(asStaffSessions.rows).toEqual([{ count: 0 }]);
    expect(asStaffLog.rows).toEqual([{ count: 0 }]);
    expect(asAnonSessions.rows).toEqual([{ count: 0 }]);
  });

  it('allows only one LINE identity to be linked to an application profile', async () => {
    await asServiceRole(db, async () => {
      await db.query(`update public.line_users set linked_user_id = $1 where id = $2`, [STAFF_ID, lineUserId]);
      await expect(db.query(
        `insert into public.line_users(line_user_id, display_name, link_status, linked_user_id)
         values ('Ucccccccccccccccccccccccccccccccc', 'LINE ซ้ำ', 'Active', $1)`,
        [STAFF_ID],
      )).rejects.toThrow();
    });
  });

  it('records a LINE-owned ticket without an employee profile and keeps it visible to help-desk staff', async () => {
    const ticket = await asServiceRole(db, async () => db.query<{ id: string; source_channel: string }>(
      `insert into public.tickets(title, requester_id, requester_name_snapshot, requester_identity_type, description, source_channel, requester_line_user_id)
       values ('เครื่องพิมพ์เสีย', null, 'ทดสอบ LINE', 'LINE', 'ใช้งานไม่ได้', 'line', $1) returning id, source_channel`,
      [lineUserId],
    ));
    expect(ticket.rows[0]!.source_channel).toBe('line');

    await asServiceRole(db, async () => db.query(
      `insert into public.ticket_worklogs(ticket_id, action, status_to, is_public, actor_id, actor_line_user_id)
       values ($1, 'เปิด Ticket', 'ใหม่', true, null, $2)`,
      [ticket.rows[0]!.id, lineUserId],
    ));

    // Help-desk staff can still read LINE-owned tickets under the normal ticket permissions.
    const own = await asUser(db, STAFF_ID, async () => db.query(
      `select source_channel from public.tickets where id = $1`, [ticket.rows[0]!.id],
    ));
    expect(own.rows).toEqual([{ source_channel: 'line' }]);
  });

  it('rejects source_channel values outside web/line', async () => {
    await asServiceRole(db, async () => {
      await expect(db.query(
        `insert into public.tickets(title, requester_id, description, source_channel) values ('x', $1, 'y', 'sms')`,
        [STAFF_ID],
      )).rejects.toThrow();
    });
  });
});
