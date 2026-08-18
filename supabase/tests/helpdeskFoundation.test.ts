import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

const ADMIN_ID = '10000000-0000-0000-0000-000000000001';
const REQUESTER_ID = '10000000-0000-0000-0000-000000000002';
const OTHER_USER_ID = '10000000-0000-0000-0000-000000000003';
const TECHNICIAN_ID = '10000000-0000-0000-0000-000000000004';
const APPROVER_ID = '10000000-0000-0000-0000-000000000005';

let db: PGlite;
let ticketId: string;

async function createUser(userId: string, email: string, roleKey: string): Promise<void> {
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [userId, email]);
    await db.query(
      `insert into public.user_roles (user_id, role_id)
       select $1, id from public.roles where key = $2`,
      [userId, roleKey],
    );
  });
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(ADMIN_ID, 'helpdesk-admin@test.local', 'it_admin');
  await createUser(REQUESTER_ID, 'helpdesk-requester@test.local', 'user');
  await createUser(OTHER_USER_ID, 'helpdesk-other@test.local', 'user');
  await createUser(TECHNICIAN_ID, 'helpdesk-technician@test.local', 'technician');
  await createUser(APPROVER_ID, 'helpdesk-approver@test.local', 'approver');
});

afterAll(async () => {
  await db.close();
});

describe('Help Desk Phase 2 foundation', () => {
  it('seeds the exact Legacy priorities, statuses and category-based SLA masters', async () => {
    const priorities = await db.query<{ ticket_value: string; name_th: string }>(
      'select ticket_value, name_th from public.ticket_priorities order by sort_order',
    );
    const statuses = await db.query<{ ticket_value: string; name_th: string; is_terminal: boolean; pauses_sla: boolean }>(
      `select ticket_value, name_th, is_terminal, pauses_sla
       from public.ticket_statuses order by sort_order`,
    );
    const categories = await db.query<{
      legacy_id: string;
      name: string;
      default_priority: string;
      response_sla_hours: number;
      resolution_sla_hours: number;
      is_security_default: boolean;
    }>(
      `select legacy_id, name, default_priority, response_sla_hours::int,
              resolution_sla_hours::int, is_security_default
       from public.ticket_categories order by sort_order`,
    );
    const slaPolicies = await db.query('select count(*)::int as count from public.ticket_sla_policies');

    expect(priorities.rows).toEqual([
      { ticket_value: 'ต่ำ', name_th: 'ต่ำ' },
      { ticket_value: 'ปานกลาง', name_th: 'ปานกลาง' },
      { ticket_value: 'สูง', name_th: 'สูง' },
      { ticket_value: 'วิกฤต', name_th: 'วิกฤต' },
    ]);
    expect(statuses.rows).toHaveLength(10);
    expect(statuses.rows.every((row) => row.ticket_value === row.name_th)).toBe(true);
    expect(statuses.rows.find((row) => row.ticket_value === 'ส่งต่อ Outsource')).toMatchObject({ pauses_sla: false });
    expect(statuses.rows.find((row) => row.ticket_value === 'เสร็จสิ้น')).toMatchObject({ is_terminal: true });
    expect(categories.rows).toEqual([
      { legacy_id: 'TCAT-001', name: 'Computer', default_priority: 'ปานกลาง', response_sla_hours: 4, resolution_sla_hours: 24, is_security_default: false },
      { legacy_id: 'TCAT-002', name: 'Notebook', default_priority: 'ปานกลาง', response_sla_hours: 4, resolution_sla_hours: 24, is_security_default: false },
      { legacy_id: 'TCAT-003', name: 'Printer', default_priority: 'ปานกลาง', response_sla_hours: 4, resolution_sla_hours: 16, is_security_default: false },
      { legacy_id: 'TCAT-004', name: 'Network', default_priority: 'สูง', response_sla_hours: 2, resolution_sla_hours: 8, is_security_default: false },
      { legacy_id: 'TCAT-005', name: 'Software', default_priority: 'ปานกลาง', response_sla_hours: 4, resolution_sla_hours: 16, is_security_default: false },
      { legacy_id: 'TCAT-006', name: 'Email', default_priority: 'สูง', response_sla_hours: 2, resolution_sla_hours: 8, is_security_default: false },
      { legacy_id: 'TCAT-007', name: 'ขอรับบริการ IT', default_priority: 'ปานกลาง', response_sla_hours: 4, resolution_sla_hours: 24, is_security_default: false },
    ]);
    expect(slaPolicies.rows[0]).toEqual({ count: 0 });
  });

  it('allocates unique Legacy-compatible TCK date/random numbers at the database layer', async () => {
    const inserted = await asServiceRole(db, async () =>
      Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          db.query(
            `insert into public.tickets (title, requester_id, description)
             values ($1, $2, 'ทดสอบเลข Ticket') returning id, ticket_no`,
            [`เลข Ticket ${index + 1}`, REQUESTER_ID],
          ),
        ),
      ),
    );

    const rows = inserted.flatMap((result) => result.rows as { id: string; ticket_no: string }[]);
    const numbers = rows.map((row) => row.ticket_no);
    ticketId = rows[0].id;

    expect(new Set(numbers).size).toBe(12);
    for (const ticketNo of numbers) {
      expect(ticketNo).toMatch(/^TCK-\d{8}-[0-9A-F]{8}$/);
    }
  });

  /**
   * เลขนี้คือสิ่งที่ผู้ใช้อ่านให้เจ้าหน้าที่ฟังทางโทรศัพท์และจดลงกระดาษ ความยาวจึงถูกตรึงไว้ด้วยเทสต์
   * ไม่ใช่ปล่อยให้ยาวขึ้นเงียบ ๆ ในอนาคต — และการออกเลขต้องไม่ชนกันเองแม้จะเหลือ 8 ตัว
   */
  it('issues a short ticket number that stays unique across a burst of allocations', async () => {
    const issued = await db.query<{ ticket_no: string }>(
      `select public.allocate_ticket_number(now()) as ticket_no from generate_series(1, 200)`,
    );
    const numbers = issued.rows.map((row) => row.ticket_no);

    expect(numbers).toHaveLength(200);
    expect(new Set(numbers).size).toBe(200);
    for (const ticketNo of numbers) {
      expect(ticketNo).toMatch(/^TCK-\d{8}-[0-9A-F]{8}$/);
      expect(ticketNo).toHaveLength(21);
    }
  });

  /** เลขที่ Ticket ต้องออกโดย trigger เท่านั้น ไม่มี role ของแอปตัวไหนเรียกฟังก์ชันนี้ตรง ๆ ได้ */
  it('keeps ticket number allocation out of reach of every application role', async () => {
    for (const runAs of [asServiceRole, asAnon]) {
      await expect(
        runAs(db, () => db.query('select public.allocate_ticket_number(now())')),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('preserves the Legacy transition matrix and Approver triage capabilities', async () => {
    const transitions = await db.query(
      'select count(*)::int as count from public.ticket_status_transitions where status = $1',
      ['active'],
    );
    expect(transitions.rows[0]).toEqual({ count: 45 });

    const permissions = await asUser(db, APPROVER_ID, async () =>
      db.query(
        `select public.has_permission('ticket.triage') as triage,
                public.has_permission('ticket.assign') as assign,
                public.has_permission('ticket.escalate') as escalate,
                public.has_permission('ticket.close') as close`,
      ),
    );
    expect(permissions.rows[0]).toEqual({ triage: true, assign: true, escalate: true, close: false });
  });

  it('keeps a regular user with ticket.view from seeing another requester ticket', async () => {
    const ownerRows = await asUser(db, REQUESTER_ID, async () =>
      db.query('select id from public.tickets where id = $1', [ticketId]),
    );
    const otherRows = await asUser(db, OTHER_USER_ID, async () =>
      db.query('select id from public.tickets where id = $1', [ticketId]),
    );
    const technicianRows = await asUser(db, TECHNICIAN_ID, async () =>
      db.query('select id from public.tickets where id = $1', [ticketId]),
    );

    expect(ownerRows.rows).toHaveLength(1);
    expect(otherRows.rows).toHaveLength(0);
    expect(technicianRows.rows).toHaveLength(1);
  });

  it('blocks requester mass assignment but permits a public comment', async () => {
    await expect(
      asUser(db, REQUESTER_ID, async () =>
        db.query(`update public.tickets set status = 'รับเรื่องแล้ว' where id = $1`, [ticketId]),
      ),
    ).rejects.toThrow(/เฉพาะแบบประเมิน/);

    const comment = await asUser(db, REQUESTER_ID, async () =>
      db.query(
        `insert into public.ticket_worklogs
          (ticket_id, entry_type, action, detail, is_public, actor_id)
         values ($1, 'comment', 'แสดงความคิดเห็น', 'ขอเพิ่มข้อมูล', true, $2)
         returning id`,
        [ticketId, REQUESTER_ID],
      ),
    );
    expect(comment.rows).toHaveLength(1);

    await expect(
      asUser(db, REQUESTER_ID, async () =>
        db.query(
          `insert into public.ticket_worklogs
            (ticket_id, entry_type, action, detail, is_public, actor_id)
           values ($1, 'internal_note', 'บันทึกภายใน', 'ข้อมูลลับ', false, $2)`,
          [ticketId, REQUESTER_ID],
        ),
      ),
    ).rejects.toThrow();
  });

  it('validates assignee role and status transitions in the database', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query('update public.tickets set assignee_id = $1 where id = $2', [OTHER_USER_ID, ticketId]),
      ),
    ).rejects.toThrow(/เจ้าหน้าที่ IT/);

    await asUser(db, ADMIN_ID, async () =>
      db.query(
        `update public.tickets
         set assignee_id = $1, status = 'รับเรื่องแล้ว', updated_by = $2
         where id = $3`,
        [TECHNICIAN_ID, ADMIN_ID, ticketId],
      ),
    );

    await expect(
      asUser(db, TECHNICIAN_ID, async () =>
        db.query(`update public.tickets set status = 'เสร็จสิ้น' where id = $1`, [ticketId]),
      ),
    ).rejects.toThrow(/ผลการแก้ไข/);

    const resolved = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(
        `update public.tickets
         set status = 'เสร็จสิ้น', resolution = 'แก้ไขการตั้งค่าเรียบร้อย', root_cause = 'ค่าระบบไม่ถูกต้อง'
         where id = $1 returning status, resolved_at`,
        [ticketId],
      ),
    );
    expect((resolved.rows[0] as { status: string }).status).toBe('เสร็จสิ้น');
    expect((resolved.rows[0] as { resolved_at: string | null }).resolved_at).not.toBeNull();

    await expect(
      asServiceRole(db, async () =>
        db.query(`update public.tickets set status = 'รออะไหล่' where id = $1`, [ticketId]),
      ),
    ).rejects.toThrow(/ไม่สามารถเปลี่ยนสถานะ/);
  });

  it('allows only the requester to submit an immutable satisfaction score', async () => {
    const submitted = await asUser(db, REQUESTER_ID, async () =>
      db.query(
        `update public.tickets
         set rating = 5, feedback = 'ให้บริการรวดเร็ว'
         where id = $1 returning rating, feedback_at`,
        [ticketId],
      ),
    );
    expect((submitted.rows[0] as { rating: number }).rating).toBe(5);
    expect((submitted.rows[0] as { feedback_at: string | null }).feedback_at).not.toBeNull();

    await expect(
      asUser(db, TECHNICIAN_ID, async () =>
        db.query('update public.tickets set rating = 1 where id = $1', [ticketId]),
      ),
    ).rejects.toThrow(/เฉพาะผู้แจ้ง/);

    await expect(
      asUser(db, REQUESTER_ID, async () =>
        db.query(`update public.tickets set feedback = 'แก้ข้อความ' where id = $1`, [ticketId]),
      ),
    ).rejects.toThrow(/ส่งแล้ว/);
  });

  it('keeps internal notes hidden from the requester', async () => {
    const inserted = await asUser(db, TECHNICIAN_ID, async () =>
      db.query(
        `insert into public.ticket_worklogs
          (ticket_id, entry_type, action, detail, is_public, actor_id)
         values ($1, 'internal_note', 'บันทึกภายใน', 'ใช้บัญชีทดสอบตรวจสอบ', false, $2)
         returning id`,
        [ticketId, TECHNICIAN_ID],
      ),
    );
    const internalNoteId = (inserted.rows[0] as { id: string }).id;

    const requesterView = await asUser(db, REQUESTER_ID, async () =>
      db.query('select id from public.ticket_worklogs where id = $1', [internalNoteId]),
    );
    const technicianView = await asUser(db, TECHNICIAN_ID, async () =>
      db.query('select id from public.ticket_worklogs where id = $1', [internalNoteId]),
    );

    expect(requesterView.rows).toHaveLength(0);
    expect(technicianView.rows).toHaveLength(1);
  });
});
