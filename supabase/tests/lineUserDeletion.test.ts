import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, createTestDb } from './testDb';

const ACTOR_ID = '00000000-0000-0000-0000-0000000000d1';

let db: PGlite;

/** สร้างบัญชี LINE พร้อม Ticket ที่บัญชีนั้นแจ้ง — โครงเดียวกับที่ routes/line.ts เขียนจริง */
async function seedLineUserWithTicket(lineUserId: string) {
  return asServiceRole(db, async () => {
    const lineUser = await db.query<{ id: string }>(
      `insert into public.line_users(line_user_id, display_name, full_name, link_status)
       values ($1, 'ทดสอบลบ LINE', 'ทดสอบลบ LINE', 'Active') returning id`,
      [lineUserId],
    );
    const id = lineUser.rows[0]!.id;

    const ticket = await db.query<{ id: string }>(
      `insert into public.tickets(title, requester_id, requester_name_snapshot, requester_identity_type, description,
         source_channel, requester_line_user_id, privacy_consent_confirmed, privacy_notice_version,
         privacy_consent_at, privacy_consent_channel, privacy_consent_text)
       values ('แอร์ไม่เย็น', null, 'ทดสอบลบ LINE', 'LINE', 'ห้องร้อน', 'line', $1,
         true, 'test-v1', now(), 'PUBLIC_TICKET_LINE', 'accepted in database test') returning id`,
      [id],
    );
    const ticketId = ticket.rows[0]!.id;

    // worklog "เปิด Ticket" มีแต่ actor_line_user_id เหมือนของจริง (actor_id/actor_label เป็น null)
    await db.query(
      `insert into public.ticket_worklogs(ticket_id, action, status_to, is_public, actor_id, actor_line_user_id)
       values ($1, 'เปิด Ticket', 'ใหม่', true, null, $2)`,
      [ticketId, id],
    );
    await db.query(
      `insert into public.file_attachments(storage_path, original_filename, mime_type, size_bytes, module, target_table, target_id, uploaded_by, uploader_label)
       values ($1, 'signature.png', 'image/png', 1024, 'ticket', 'tickets', $2, null, 'ผู้แจ้งผ่าน LINE: ทดสอบลบ LINE')`,
      [`tickets/${ticketId}/signature.png`, ticketId],
    );
    return { id, ticketId };
  });
}

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users (id, email) values ($1, 'line-delete-actor@test.local')`, [ACTOR_ID]);
  });
});

afterAll(async () => { await db.close(); });

describe('deleting a LINE account', () => {
  it('cascades its tickets, worklogs and attachment metadata instead of failing the identity check', async () => {
    const { id, ticketId } = await seedLineUserWithTicket('Udeleteaaaaaaaaaaaaaaaaaaaaaaaaa1');

    const result = await asServiceRole(db, async () => db.query<{ result: Record<string, unknown> }>(
      `select public.mutate_record_deletion('line-links', $1, $2, $3, $4, $5) as result`,
      [id, ACTOR_ID, 'line-delete-actor@test.local', 'ผู้ใช้ขอให้ลบข้อมูลตาม PDPA', 'req-line-delete-1'],
    ));
    expect(result.rows[0]!.result).toMatchObject({ resource: 'line-links', mode: 'hard', cascadedTickets: 1, cascadedWorklogs: 1 });

    const remaining = await asServiceRole(db, async () => db.query<{ users: number; tickets: number; worklogs: number; files: number }>(
      `select
         (select count(*)::int from public.line_users where id = $1) as users,
         (select count(*)::int from public.tickets where id = $2) as tickets,
         (select count(*)::int from public.ticket_worklogs where ticket_id = $2) as worklogs,
         (select count(*)::int from public.file_attachments where target_table = 'tickets' and target_id = $2::text) as files`,
      [id, ticketId],
    ));
    expect(remaining.rows[0]).toEqual({ users: 0, tickets: 0, worklogs: 0, files: 0 });
  });

  it('keeps the cascade count in the audit log after the tickets themselves are gone', async () => {
    const audit = await asServiceRole(db, async () => db.query<{ action: string; detail: Record<string, unknown> }>(
      `select action, detail from public.audit_logs where request_id = 'req-line-delete-1'`,
    ));
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.action).toBe('DELETE');
    expect(audit.rows[0]!.detail).toMatchObject({ resource: 'line-links', cascadedTickets: 1 });
  });

  it('clears the RESTRICT-guarded ticket dependents that would otherwise block the delete', async () => {
    const { id, ticketId } = await seedLineUserWithTicket('Udeleteaaaaaaaaaaaaaaaaaaaaaaaaa2');
    await asServiceRole(db, async () => {
      const problem = await db.query<{ id: string }>(
        `insert into public.problems(problem_number, title, category, priority, created_by, updated_by)
         values ('PRB-LINE-DEL-1', 'ปัญหาซ้ำจากแอร์', 'อื่นๆ', 'ปานกลาง', $1, $1) returning id`,
        [ACTOR_ID],
      );
      await db.query(`insert into public.problem_tickets(problem_id, ticket_id, created_by) values ($1, $2, $3)`,
        [problem.rows[0]!.id, ticketId, ACTOR_ID]);
      await db.query(
        `insert into public.ticket_sla_dispatches(ticket_id, milestone, due_at, recipient_id, recipient_role)
         values ($1, 'RESPONSE_BREACHED', now(), $2, 'assignee')`,
        [ticketId, ACTOR_ID],
      );
    });

    await asServiceRole(db, async () => db.query(`delete from public.line_users where id = $1`, [id]));

    const remaining = await asServiceRole(db, async () => db.query<{ links: number; dispatches: number; problems: number }>(
      `select
         (select count(*)::int from public.problem_tickets where ticket_id = $1) as links,
         (select count(*)::int from public.ticket_sla_dispatches where ticket_id = $1) as dispatches,
         (select count(*)::int from public.problems) as problems`,
      [ticketId],
    ));
    // การเชื่อมกับ Problem ถูกตัด แต่ตัว Problem เองยังอยู่ครบ
    expect(remaining.rows[0]).toEqual({ links: 0, dispatches: 0, problems: 1 });
  });

  it('still deletes a LINE account that never opened a ticket', async () => {
    const lineUser = await asServiceRole(db, async () => db.query<{ id: string }>(
      `insert into public.line_users(line_user_id, display_name, link_status)
       values ('Udeleteaaaaaaaaaaaaaaaaaaaaaaaaa3', 'ยังไม่เคยแจ้งงาน', 'Active') returning id`,
    ));
    const result = await asServiceRole(db, async () => db.query<{ result: Record<string, unknown> }>(
      `select public.mutate_record_deletion('line-links', $1, $2, $3, $4, $5) as result`,
      [lineUser.rows[0]!.id, ACTOR_ID, 'line-delete-actor@test.local', 'บัญชีทดสอบที่ไม่ได้ใช้แล้ว', 'req-line-delete-2'],
    ));
    expect(result.rows[0]!.result).toMatchObject({ cascadedTickets: 0, cascadedWorklogs: 0 });
  });
});
