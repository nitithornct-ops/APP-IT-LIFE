import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, createTestDb } from './testDb';

const REQUESTER_ID = '00000000-0000-0000-0000-0000000000f1';
const STAFF_A_ID = '00000000-0000-0000-0000-0000000000f2';
const STAFF_B_ID = '00000000-0000-0000-0000-0000000000f3';
const DEPARTMENT_ID = '00000000-0000-0000-0000-0000000000f4';
const CATALOG_ID = '00000000-0000-0000-0000-0000000000f5';
const REQUEST_ID = '00000000-0000-0000-0000-0000000000f6';
const SLA_REQUEST_ID = '00000000-0000-0000-0000-0000000000f7';
const PAUSED_REQUEST_ID = '00000000-0000-0000-0000-0000000000f8';
const ATTACHMENT_CATALOG_ID = '00000000-0000-0000-0000-0000000000f9';
const ATTACHMENT_REQUEST_ID = '00000000-0000-0000-0000-0000000000fa';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email) values
       ($1, 'service-request-requester@test.local'),
       ($2, 'service-request-staff-a@test.local'),
       ($3, 'service-request-staff-b@test.local')`,
      [REQUESTER_ID, STAFF_A_ID, STAFF_B_ID],
    );
    await db.query(
      `insert into public.departments (id, code, name_th, status)
       values ($1, 'IT-AUTOMATION', 'ฝ่าย IT Automation', 'active')`,
      [DEPARTMENT_ID],
    );
    await db.query(
      `update public.profiles
       set department_id = $1
       where id in ($2, $3)`,
      [DEPARTMENT_ID, STAFF_A_ID, STAFF_B_ID],
    );
    await db.query(
      `insert into public.service_catalog
       (id, service_code, service_name, status, fulfillment_group_id, owner_id, auto_assign, auto_create_task)
       values ($1, 'AUTO-ACCOUNT', 'สร้าง Account อัตโนมัติ', 'active', $2, $3, true, true)`,
      [CATALOG_ID, DEPARTMENT_ID, STAFF_B_ID],
    );
    await db.query(
      `insert into public.service_requests
       (id, catalog_id, service_code, service_name, requester_id, summary, assigned_group_id,
        status, approval_status, due_at, created_by, service_owner_id)
       values ($1, $2, 'AUTO-ACCOUNT', 'สร้าง Account อัตโนมัติ', $3, 'คำขอทดสอบ auto assignment',
               $4, 'รอมอบหมาย', 'not_required', '2026-09-12T12:00:00Z', $3, $5)`,
      [REQUEST_ID, CATALOG_ID, REQUESTER_ID, DEPARTMENT_ID, STAFF_B_ID],
    );
    await db.query(
      `insert into public.service_requests
       (id, catalog_id, service_code, service_name, requester_id, summary, assigned_group_id,
        assignee_id, service_owner_id, status, approval_status, due_at, created_by)
       values ($1, $2, 'AUTO-ACCOUNT', 'สร้าง Account อัตโนมัติ', $3, 'คำขอใกล้ครบกำหนด',
               $4, $5, $6, 'กำลังดำเนินการ', 'not_required', '2026-09-11T12:45:00Z', $3)`,
      [SLA_REQUEST_ID, CATALOG_ID, REQUESTER_ID, DEPARTMENT_ID, STAFF_A_ID, STAFF_B_ID],
    );
    await db.query(
      `insert into public.service_requests
       (id, catalog_id, service_code, service_name, requester_id, summary, assigned_group_id,
        assignee_id, service_owner_id, status, approval_status, due_at, sla_paused_at, created_by)
       values ($1, $2, 'AUTO-ACCOUNT', 'สร้าง Account อัตโนมัติ', $3, 'คำขอที่พัก SLA',
               $4, $5, $6, 'รอผู้ใช้งาน', 'not_required', '2026-09-11T12:10:00Z',
               '2026-09-11T12:00:00Z', $3)`,
      [PAUSED_REQUEST_ID, CATALOG_ID, REQUESTER_ID, DEPARTMENT_ID, STAFF_A_ID, STAFF_B_ID],
    );
    await db.query(
      `insert into public.service_catalog
       (id, service_code, service_name, status, fulfillment_group_id, attachment_required, auto_assign)
       values ($1, 'AUTO-ATTACH', 'บริการที่ต้องแนบไฟล์', 'active', $2, true, true)`,
      [ATTACHMENT_CATALOG_ID, DEPARTMENT_ID],
    );
    await db.query(
      `insert into public.service_requests
       (id, catalog_id, service_code, service_name, requester_id, summary, assigned_group_id,
        status, approval_status, due_at, created_by)
       values ($1, $2, 'AUTO-ATTACH', 'บริการที่ต้องแนบไฟล์', $3, 'คำขอที่ต้องรอไฟล์แนบ',
               $4, 'รอมอบหมาย', 'not_required', '2026-09-12T12:00:00Z', $3)`,
      [ATTACHMENT_REQUEST_ID, ATTACHMENT_CATALOG_ID, REQUESTER_ID, DEPARTMENT_ID],
    );
  });
});

afterAll(async () => db.close());

describe('service request automation', () => {
  it('assigns the least-loaded staff, creates one task, and links it to the request', async () => {
    const first = await asServiceRole(db, async () => db.query(
      `select public.auto_assign_service_request($1, $2) as result`,
      [REQUEST_ID, REQUESTER_ID],
    ));
    const result = (first.rows[0] as { result: { assigned: boolean; assigneeId: string; fulfillmentTaskId: string } }).result;
    expect(result.assigned).toBe(true);
    expect(result.assigneeId).toBe(STAFF_B_ID);
    expect(result.fulfillmentTaskId).toBeTruthy();

    const request = await asServiceRole(db, async () => db.query(
      `select assignee_id, status, fulfillment_task_id, fulfillment_started_at
       from public.service_requests where id = $1`,
      [REQUEST_ID],
    ));
    expect(request.rows[0]).toMatchObject({ assignee_id: STAFF_B_ID, status: 'กำลังดำเนินการ' });
    expect((request.rows[0] as { fulfillment_task_id: string }).fulfillment_task_id).toBe(result.fulfillmentTaskId);
    expect((request.rows[0] as { fulfillment_started_at: string }).fulfillment_started_at).toBeTruthy();

    const task = await asServiceRole(db, async () => db.query(
      `select owner_id, task_type, priority, status from public.personal_tasks where id = $1`,
      [result.fulfillmentTaskId],
    ));
    expect(task.rows).toEqual([{ owner_id: STAFF_B_ID, task_type: 'other', priority: 'ปกติ', status: 'ต้องทำ' }]);

    const link = await asServiceRole(db, async () => db.query(
      `select owner_id, record_type, record_id from public.task_record_links where task_id = $1`,
      [result.fulfillmentTaskId],
    ));
    expect(link.rows).toEqual([{ owner_id: STAFF_B_ID, record_type: 'service_request', record_id: REQUEST_ID }]);

    const second = await asServiceRole(db, async () => db.query(
      `select public.auto_assign_service_request($1, $2) as result`,
      [REQUEST_ID, REQUESTER_ID],
    ));
    expect((second.rows[0] as { result: { assigned: boolean; reason: string } }).result).toMatchObject({ assigned: false, reason: 'not_queued' });
    const taskCount = await asServiceRole(db, async () => db.query(
      `select count(*)::int as count from public.task_record_links where record_id = $1`,
      [REQUEST_ID],
    ));
    expect(taskCount.rows).toEqual([{ count: 1 }]);
  });

  it('dispatches warning/breach notifications once and skips paused requests', async () => {
    const warning = await asServiceRole(db, async () => db.query(
      `select public.dispatch_service_request_sla_escalations('2026-09-11T12:00:00Z') as result`,
    ));
    expect((warning.rows[0] as { result: object }).result).toEqual({ warnings: 2, breaches: 0, escalations: 0 });

    const repeatedWarning = await asServiceRole(db, async () => db.query(
      `select public.dispatch_service_request_sla_escalations('2026-09-11T12:05:00Z') as result`,
    ));
    expect((repeatedWarning.rows[0] as { result: object }).result).toEqual({ warnings: 0, breaches: 0, escalations: 0 });

    const breach = await asServiceRole(db, async () => db.query(
      `select public.dispatch_service_request_sla_escalations('2026-09-11T12:50:00Z') as result`,
    ));
    expect((breach.rows[0] as { result: object }).result).toEqual({ warnings: 0, breaches: 2, escalations: 1 });

    const paused = await asServiceRole(db, async () => db.query(
      `select public.dispatch_service_request_sla_escalations('2026-09-11T12:20:00Z') as result`,
    ));
    expect((paused.rows[0] as { result: object }).result).toEqual({ warnings: 0, breaches: 0, escalations: 0 });

    const notifications = await asServiceRole(db, async () => db.query(
      `select recipient_id, type from public.notifications
       where recipient_id in ($1, $2) and type like 'service_request_sla_%'
       order by type, recipient_id`,
      [STAFF_A_ID, STAFF_B_ID],
    ));
    expect(notifications.rows).toHaveLength(4);
  });

  it('does not start fulfillment before a required attachment is present', async () => {
    const result = await asServiceRole(db, async () => db.query(
      `select public.auto_assign_service_request($1, $2) as result`,
      [ATTACHMENT_REQUEST_ID, REQUESTER_ID],
    ));
    expect((result.rows[0] as { result: object }).result).toEqual({ assigned: false, reason: 'attachment_required' });

    const request = await asServiceRole(db, async () => db.query(
      `select assignee_id, status from public.service_requests where id = $1`,
      [ATTACHMENT_REQUEST_ID],
    ));
    expect(request.rows).toEqual([{ assignee_id: null, status: 'รอมอบหมาย' }]);
  });
});
