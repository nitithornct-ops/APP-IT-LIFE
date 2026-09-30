import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const REQUESTER_ID = '20000000-0000-0000-0000-000000000001';
const TECHNICIAN_ID = '20000000-0000-0000-0000-000000000002';
const ADMIN_ID = '20000000-0000-0000-0000-000000000003';
const RATING_DETAILS = '{"responsiveness":5,"workQuality":5,"serviceManners":5,"expertise":5,"communication":5}';

let db: PGlite;
let statuses: string[];

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

async function createTicket(assetId?: string): Promise<string> {
  const result = await asServiceRole(db, () => db.query<{ id: string }>(
    `insert into public.tickets
       (title, requester_id, description, assignee_id, asset_id,
        response_sla_hours, resolution_sla_hours, response_due_at, due_at)
     values ('Integrity test', $1, 'Workflow integrity test', $2, $3, 4, 24,
             now() + interval '4 hours', now() + interval '24 hours')
     returning id`,
    [REQUESTER_ID, TECHNICIAN_ID, assetId ?? null],
  ));
  return result.rows[0].id;
}

async function moveTicketToClosedWithSignoff(ticketId: string): Promise<void> {
  await asUser(db, ADMIN_ID, () => db.query(
    'update public.tickets set status = $1 where id = $2',
    [statuses[2], ticketId],
  ));
  await asUser(db, TECHNICIAN_ID, () => db.query(
    `update public.tickets set status = $1, resolution = 'แก้ไขแล้ว' where id = $2`,
    [statuses[6], ticketId],
  ));
  await asServiceRole(db, () => db.query(
    `select public.complete_ticket_requester_signoff(
       $1, $2, $3, null, 5, $4::jsonb,
       '[{"key":"responsiveness","label":"ความรวดเร็ว","score":5}]'::jsonb,
       'ตรวจรับแล้ว', 'tickets/test/signature.png', now(), 'ลงนามตรวจรับ'
     )`,
    [ticketId, statuses[6], REQUESTER_ID, RATING_DETAILS],
  ));
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(REQUESTER_ID, 'ticket-integrity-requester@test.local', 'user');
  await createUser(TECHNICIAN_ID, 'ticket-integrity-technician@test.local', 'technician');
  await createUser(ADMIN_ID, 'ticket-integrity-admin@test.local', 'it_admin');
  const result = await db.query<{ ticket_value: string }>(
    'select ticket_value from public.ticket_statuses order by sort_order',
  );
  statuses = result.rows.map((row) => row.ticket_value);
});

afterAll(async () => {
  await db.close();
});

describe('Ticket workflow integrity', () => {
  it('records first response when work starts and keeps status/worklog atomic', async () => {
    const ticketId = await createTicket();
    const inProgress = statuses[2];
    const newStatus = statuses[0];

    await asUser(db, ADMIN_ID, () => db.query(
      'update public.tickets set status = $1 where id = $2',
      [inProgress, ticketId],
    ));

    const responseTimes = await db.query<{ started_at: string | null; acknowledged_at: string | null; first_response_at: string | null }>(
      'select started_at, acknowledged_at, first_response_at from public.tickets where id = $1',
      [ticketId],
    );
    expect(responseTimes.rows[0].started_at).not.toBeNull();
    expect(responseTimes.rows[0].acknowledged_at).not.toBeNull();
    expect(responseTimes.rows[0].first_response_at).not.toBeNull();

    await asUser(db, ADMIN_ID, () => db.query(
      `select public.transition_ticket_with_worklog(
         $1, $2, '{}'::jsonb, 'บันทึกผลทดสอบ', 'atomic worklog', null
       )`,
      [ticketId, inProgress],
    ));
    const beforeStale = await db.query<{ count: number }>(
      'select count(*)::int as count from public.ticket_worklogs where ticket_id = $1',
      [ticketId],
    );

    await expect(asUser(db, ADMIN_ID, () => db.query(
      `select public.transition_ticket_with_worklog(
         $1, $2, '{}'::jsonb, 'ไม่ควรถูกบันทึก', null, null
       )`,
      [ticketId, newStatus],
    ))).rejects.toThrow(/TICKET_STALE_STATE/);

    const afterStale = await db.query<{ count: number }>(
      'select count(*)::int as count from public.ticket_worklogs where ticket_id = $1',
      [ticketId],
    );
    expect(afterStale.rows[0].count).toBe(beforeStale.rows[0].count);
  });

  it('requires and clears waiting follow-up metadata at the database boundary', async () => {
    const ticketId = await createTicket();
    const inProgress = statuses[2];
    const waitingParts = statuses[3];

    await asUser(db, ADMIN_ID, () => db.query(
      `update public.tickets
       set status = $1, waiting_reason = 'รออะไหล่', waiting_owner_id = $2,
           waiting_follow_up_at = now() + interval '1 day', waiting_since = now(),
           sla_paused_at = now()
       where id = $3`,
      [inProgress, TECHNICIAN_ID, ticketId],
    ));
    await asUser(db, ADMIN_ID, () => db.query(
      `update public.tickets
       set status = $1, waiting_reason = 'รออะไหล่', waiting_owner_id = $2,
           waiting_follow_up_at = now() + interval '1 day'
       where id = $3`,
      [waitingParts, TECHNICIAN_ID, ticketId],
    ));

    const waiting = await db.query<{ waiting_reason: string; waiting_owner_id: string; waiting_follow_up_at: string | null }>(
      'select waiting_reason, waiting_owner_id, waiting_follow_up_at from public.tickets where id = $1',
      [ticketId],
    );
    expect(waiting.rows[0]).toMatchObject({ waiting_reason: 'รออะไหล่', waiting_owner_id: TECHNICIAN_ID });
    expect(waiting.rows[0].waiting_follow_up_at).not.toBeNull();

    await asUser(db, ADMIN_ID, () => db.query(
      'update public.tickets set status = $1 where id = $2',
      [inProgress, ticketId],
    ));
    const resumed = await db.query<{ waiting_reason: string | null; waiting_owner_id: string | null; waiting_follow_up_at: string | null }>(
      'select waiting_reason, waiting_owner_id, waiting_follow_up_at from public.tickets where id = $1',
      [ticketId],
    );
    expect(resumed.rows[0]).toEqual({ waiting_reason: null, waiting_owner_id: null, waiting_follow_up_at: null });
  });

  it('keeps the completed SLA round when a requester sends the Ticket back', async () => {
    const ticketId = await createTicket();
    const inProgress = statuses[2];
    const resolved = statuses[6];
    await asUser(db, ADMIN_ID, () => db.query(
      'update public.tickets set status = $1 where id = $2',
      [inProgress, ticketId],
    ));
    await asUser(db, TECHNICIAN_ID, () => db.query(
      `update public.tickets set status = $1, resolution = 'แก้ไขแล้ว' where id = $2`,
      [resolved, ticketId],
    ));
    const oldRound = await db.query<{ resolution_due_at: string | null }>(
      `select resolution_due_at from public.ticket_sla_rounds
       where ticket_id = $1 and round_no = 1`,
      [ticketId],
    );

    await asServiceRole(db, () => db.query(
      `select public.requester_reopen_ticket(
         $1, $2, 'ยังใช้งานไม่ได้', now() + interval '2 hours', now() + interval '12 hours'
       )`,
      [ticketId, REQUESTER_ID],
    ));

    const rounds = await db.query<{ round_no: number; status: string; resolution_due_at: string | null }>(
      `select round_no, status, resolution_due_at from public.ticket_sla_rounds
       where ticket_id = $1 order by round_no`,
      [ticketId],
    );
    expect(rounds.rows).toHaveLength(2);
    expect(rounds.rows[0].status).toBe('resolved');
    expect(String(rounds.rows[0].resolution_due_at)).toBe(String(oldRound.rows[0].resolution_due_at));
    expect(rounds.rows[1]).toMatchObject({ round_no: 2, status: 'open' });
  });

  it('archives and clears requester sign-off when the web requester reopens a closed Ticket', async () => {
    const ticketId = await createTicket();
    await moveTicketToClosedWithSignoff(ticketId);

    await asServiceRole(db, () => db.query(
      `select public.requester_reopen_ticket(
         $1, $2, 'ยังใช้งานไม่ได้จากหน้าเว็บ', now() + interval '2 hours', now() + interval '12 hours'
       )`,
      [ticketId, REQUESTER_ID],
    ));

    const ticket = await db.query<{
      status: string;
      rating: number | null;
      feedback: string | null;
      feedback_at: string | null;
      requester_signature_storage_path: string | null;
    }>(
      `select status, rating, feedback, feedback_at, requester_signature_storage_path
       from public.tickets where id = $1`,
      [ticketId],
    );
    expect(ticket.rows[0]).toEqual({
      status: 'กำลังดำเนินการ',
      rating: null,
      feedback: null,
      feedback_at: null,
      requester_signature_storage_path: null,
    });

    const history = await db.query<{
      status_before_reopen: string;
      rating: number;
      feedback: string;
      requester_signature_storage_path: string;
      source_channel: string;
      archived_by: string | null;
    }>(
      `select status_before_reopen, rating, feedback, requester_signature_storage_path,
              source_channel, archived_by
       from public.ticket_signoff_history where ticket_id = $1`,
      [ticketId],
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({
      status_before_reopen: 'ปิดงาน',
      rating: 5,
      feedback: 'ตรวจรับแล้ว',
      requester_signature_storage_path: 'tickets/test/signature.png',
      source_channel: 'web',
      archived_by: REQUESTER_ID,
    });
  });

  it('archives sign-off when staff reopens a closed Ticket', async () => {
    const ticketId = await createTicket();
    await moveTicketToClosedWithSignoff(ticketId);

    await asUser(db, ADMIN_ID, () => db.query(
      `update public.tickets
       set status = 'กำลังดำเนินการ', updated_by = $1
       where id = $2`,
      [ADMIN_ID, ticketId],
    ));

    const result = await db.query<{ rating: number | null; feedback: string | null }>(
      'select rating, feedback from public.tickets where id = $1',
      [ticketId],
    );
    expect(result.rows[0]).toEqual({ rating: null, feedback: null });

    const history = await db.query<{ source_channel: string; archived_by: string | null }>(
      'select source_channel, archived_by from public.ticket_signoff_history where ticket_id = $1',
      [ticketId],
    );
    expect(history.rows).toEqual([{ source_channel: 'staff', archived_by: ADMIN_ID }]);
  });

  it('archives sign-off for a LINE requester reopen and keeps the LINE actor identity', async () => {
    const lineUser = await asServiceRole(db, () => db.query<{ id: string }>(
      `insert into public.line_users (line_user_id, display_name, link_status)
       values ('UTicketIntegrityLine000000000001', 'Ticket integrity LINE user', 'Active')
       returning id`,
    ));
    const ticket = await asServiceRole(db, () => db.query<{ id: string }>(
      `insert into public.tickets
         (title, requester_id, requester_line_user_id, source_channel, description,
          assignee_id, response_sla_hours, resolution_sla_hours, response_due_at, due_at,
          privacy_consent_confirmed, privacy_notice_version, privacy_consent_at,
          privacy_consent_channel, privacy_consent_text)
       values ('LINE integrity test', $1, $2, 'line', 'LINE workflow integrity test', $3, 4, 24,
               now() + interval '4 hours', now() + interval '24 hours', true, 'test', now(),
               'PUBLIC_TICKET_LINE', 'ยืนยันประกาศความเป็นส่วนตัวสำหรับการทดสอบ')
       returning id`,
      [REQUESTER_ID, lineUser.rows[0].id, TECHNICIAN_ID],
    ));
    await moveTicketToClosedWithSignoff(ticket.rows[0].id);

    await asServiceRole(db, () => db.query(
      `select public.line_requester_reopen_ticket(
         $1, $2, $3, 'ยังใช้งานไม่ได้จาก LINE', now() + interval '2 hours', now() + interval '12 hours'
       )`,
      [ticket.rows[0].id, lineUser.rows[0].id, REQUESTER_ID],
    ));

    const current = await db.query<{ rating: number | null; feedback: string | null }>(
      'select rating, feedback from public.tickets where id = $1',
      [ticket.rows[0].id],
    );
    expect(current.rows[0]).toEqual({ rating: null, feedback: null });

    const history = await db.query<{ source_channel: string; archived_line_user_id: string | null }>(
      'select source_channel, archived_line_user_id from public.ticket_signoff_history where ticket_id = $1',
      [ticket.rows[0].id],
    );
    expect(history.rows).toEqual([{ source_channel: 'line', archived_line_user_id: lineUser.rows[0].id }]);
  });

  it('stores an exact Ticket-to-PM link without replacing the PM history', async () => {
    const asset = await asServiceRole(db, () => db.query<{ id: string }>(
      `insert into public.assets (asset_code, name) values ('AST-TICKET-PM-TEST', 'Ticket PM test asset') returning id`,
    ));
    const plan = await asServiceRole(db, () => db.query<{ id: string }>(
      `insert into public.maintenance_plans (asset_id, plan_date, result, notes)
       values ($1, current_date, 'พบอาการผิดปกติ', 'ผลตรวจจากรอบ PM') returning id`,
      [asset.rows[0].id],
    ));
    const ticketId = await createTicket(asset.rows[0].id);

    await asServiceRole(db, () => db.query(
      `insert into public.ticket_maintenance_links
         (ticket_id, maintenance_plan_id, relationship, notes, created_by)
       values ($1, $2, 'root_cause', 'รอบ PM ที่พบปัญหา', $3)`,
      [ticketId, plan.rows[0].id, TECHNICIAN_ID],
    ));
    const link = await db.query<{ maintenance_plan_id: string; result: string | null }>(
      `select link.maintenance_plan_id, plan.result
       from public.ticket_maintenance_links link
       join public.maintenance_plans plan on plan.id = link.maintenance_plan_id
       where link.ticket_id = $1`,
      [ticketId],
    );
    expect(link.rows).toEqual([{ maintenance_plan_id: plan.rows[0].id, result: 'พบอาการผิดปกติ' }]);
  });

  it('attributes the initial worklog when a guest Ticket has no profile identity', async () => {
    const ticket = await asServiceRole(db, () => db.query<{ id: string }>(
      `insert into public.tickets
         (title, description, requester_id, source_channel, guest_name, public_tracking_token_hash,
          privacy_consent_confirmed, privacy_notice_version, privacy_consent_at,
          privacy_consent_channel, privacy_consent_text)
       values ('Guest workflow integrity test', 'Guest Ticket test', null, 'guest', 'Public Tester', repeat('a', 64),
          true, 'test', now(), 'PUBLIC_TICKET_WEB', 'Guest workflow integrity consent')
       returning id`,
    ));

    const worklog = await db.query<{
      actor_id: string | null;
      actor_line_user_id: string | null;
      actor_label: string | null;
    }>(
      `select actor_id, actor_line_user_id, actor_label
       from public.ticket_worklogs where ticket_id = $1`,
      [ticket.rows[0].id],
    );

    expect(worklog.rows).toHaveLength(1);
    expect(worklog.rows[0]).toMatchObject({ actor_id: null, actor_line_user_id: null });
    expect(worklog.rows[0].actor_label).not.toBeNull();
  });
});
