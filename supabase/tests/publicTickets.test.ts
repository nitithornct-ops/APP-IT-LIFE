import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

const STAFF_ID = '00000000-0000-0000-0000-000000002401';
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users(id,email) values ($1,'public-ticket-staff@test.local')`, [STAFF_ID]);
    await db.query(
      `insert into public.user_roles(user_id,role_id) select $1::uuid, id from public.roles where key = 'technician'`,
      [STAFF_ID],
    );
  });
});

afterAll(async () => { await db.close(); });

describe('Public (no-login) ticket report page database controls (migration 20260831100000)', () => {
  it('accepts a guest ticket with requester_id null, guest_name + tracking token hash set, source_channel = guest', async () => {
    const inserted = await asServiceRole(db, async () => db.query<{ id: string; source_channel: string; requester_id: string | null }>(
      `insert into public.tickets(title, description, source_channel, guest_name, guest_department, public_tracking_token_hash)
       values ('เครื่องพิมพ์เสีย', 'พิมพ์ไม่ออก', 'guest', 'สมชาย ใจดี', 'บัญชี', repeat('a', 64)) returning id, source_channel, requester_id`,
    ));
    expect(inserted.rows[0]).toEqual({ id: expect.any(String), source_channel: 'guest', requester_id: null });
  });

  it('rejects a null-requester ticket that has no guest identity at all (tickets_requester_identity_check)', async () => {
    await asServiceRole(db, async () => {
      await expect(db.query(
        `insert into public.tickets(title, description, source_channel) values ('x', 'y', 'guest')`,
      )).rejects.toThrow();
    });
  });

  it('still rejects source_channel values outside web/line/guest', async () => {
    await asServiceRole(db, async () => {
      await expect(db.query(
        `insert into public.tickets(title, requester_id, description, source_channel) values ('x', $1, 'y', 'sms')`,
        [STAFF_ID],
      )).rejects.toThrow();
    });
  });

  it('enforces a unique tracking token hash across guest tickets', async () => {
    await asServiceRole(db, async () => {
      await db.query(
        `insert into public.tickets(title, description, source_channel, guest_name, public_tracking_token_hash)
         values ('a', 'b', 'guest', 'คนที่ 1', repeat('b', 64))`,
      );
      await expect(db.query(
        `insert into public.tickets(title, description, source_channel, guest_name, public_tracking_token_hash)
         values ('c', 'd', 'guest', 'คนที่ 2', repeat('b', 64))`,
      )).rejects.toThrow();
    });
  });

  it('accepts a guest worklog with actor_id null and actor_label set, but rejects one with no actor identity at all', async () => {
    const ticket = await asServiceRole(db, async () => db.query<{ id: string }>(
      `insert into public.tickets(title, description, source_channel, guest_name, public_tracking_token_hash)
       values ('e', 'f', 'guest', 'ผู้แจ้ง', repeat('c', 64)) returning id`,
    ));
    const ticketId = ticket.rows[0]!.id;

    await asServiceRole(db, async () => {
      const worklog = await db.query<{ actor_id: string | null; actor_label: string | null }>(
        `insert into public.ticket_worklogs(ticket_id, action, status_to, is_public, actor_label)
         values ($1, 'เปิด Ticket', 'ใหม่', true, 'ผู้แจ้งผ่านหน้าสาธารณะ: ผู้แจ้ง') returning actor_id, actor_label`,
        [ticketId],
      );
      expect(worklog.rows[0]).toEqual({ actor_id: null, actor_label: 'ผู้แจ้งผ่านหน้าสาธารณะ: ผู้แจ้ง' });

      await expect(db.query(
        `insert into public.ticket_worklogs(ticket_id, action, status_to, is_public) values ($1, 'x', 'ใหม่', true)`,
        [ticketId],
      )).rejects.toThrow();
    });
  });

  it('lets staff with ticket.view see a guest ticket via the existing tickets RLS policy, while anon sees none', async () => {
    const ticket = await asServiceRole(db, async () => db.query<{ id: string }>(
      `insert into public.tickets(title, description, source_channel, guest_name, public_tracking_token_hash)
       values ('เมาส์เสีย', 'คลิกไม่ติด', 'guest', 'ผู้แจ้งทดสอบ', repeat('d', 64)) returning id`,
    ));
    const ticketId = ticket.rows[0]!.id;

    const staffView = await asUser(db, STAFF_ID, async () => db.query(
      `select guest_name from public.tickets where id = $1`, [ticketId],
    ));
    expect(staffView.rows).toEqual([{ guest_name: 'ผู้แจ้งทดสอบ' }]);

    const anonView = await asAnon(db, async () => db.query(`select count(*)::int as count from public.tickets where id = $1`, [ticketId]));
    expect(anonView.rows).toEqual([{ count: 0 }]);
  });
});
