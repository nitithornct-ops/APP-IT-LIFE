import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const USER_A_ID = '00000000-0000-0000-0000-0000000000d1';
const USER_B_ID = '00000000-0000-0000-0000-0000000000d2';
let db: PGlite;
let firstTaskId: string;
let prerequisiteTaskId: string;
let templateId: string;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
      USER_A_ID, 'task-extension-a@test.local', USER_B_ID, 'task-extension-b@test.local',
    ]);
  });

  const tasks = await asUser(db, USER_A_ID, async () => db.query(
    `insert into public.personal_tasks (owner_id, title, estimate_hours, actual_hours, blocked_reason)
     values ($1, 'ทำงานหลัก', 8.5, 2.25, 'รอข้อมูลจากผู้ดูแลระบบ'),
            ($1, 'เตรียมข้อมูล', 1.5, null, null)
     returning id, title`,
    [USER_A_ID],
  ));
  firstTaskId = (tasks.rows.find((row) => (row as { title: string }).title === 'ทำงานหลัก') as { id: string }).id;
  prerequisiteTaskId = (tasks.rows.find((row) => (row as { title: string }).title === 'เตรียมข้อมูล') as { id: string }).id;

  const template = await asServiceRole(db, async () => db.query(
    `insert into public.task_templates (owner_id, name, title, recurrence, due_offset_days, estimate_hours, checklist, created_by, updated_by)
     values ($1, 'ตรวจ Backup ทุกเดือน', 'ตรวจสอบ Backup ประจำเดือน', 'รายเดือน', 2, 3.5, '["ตรวจผลสำรองข้อมูล", "บันทึกผลการตรวจ"]'::jsonb, $1, $1)
     returning id`,
    [USER_A_ID],
  ));
  templateId = (template.rows[0] as { id: string }).id;
});

afterAll(async () => db.close());

describe('personal task extensions', () => {
  it('stores hours and blocked reason while keeping task data owner-scoped', async () => {
    const own = await asUser(db, USER_A_ID, async () => db.query(
      'select estimate_hours, actual_hours, blocked_reason from public.personal_tasks where id = $1',
      [firstTaskId],
    ));
    const other = await asUser(db, USER_B_ID, async () => db.query(
      'select id from public.personal_tasks where id = $1',
      [firstTaskId],
    ));
    expect(own.rows).toEqual([{ estimate_hours: '8.50', actual_hours: '2.25', blocked_reason: 'รอข้อมูลจากผู้ดูแลระบบ' }]);
    expect(other.rows).toHaveLength(0);
  });

  it('allows same-owner dependencies and rejects self, cross-owner, and cyclic edges', async () => {
    await asUser(db, USER_A_ID, async () => db.query(
      `insert into public.task_dependencies (task_id, depends_on_task_id, owner_id, note)
       values ($1, $2, $3, 'ต้องเตรียมข้อมูลก่อนเริ่ม')`,
      [firstTaskId, prerequisiteTaskId, USER_A_ID],
    ));

    await expect(asUser(db, USER_A_ID, async () => db.query(
      `insert into public.task_dependencies (task_id, depends_on_task_id, owner_id)
       values ($1, $2, $3)`,
      [prerequisiteTaskId, firstTaskId, USER_A_ID],
    ))).rejects.toThrow(/TASK_DEPENDENCY_CYCLE/);

    await expect(asUser(db, USER_A_ID, async () => db.query(
      `insert into public.task_dependencies (task_id, depends_on_task_id, owner_id)
       values ($1, $1, $2)`,
      [firstTaskId, USER_A_ID],
    ))).rejects.toThrow();

    await expect(asUser(db, USER_B_ID, async () => db.query(
      `insert into public.task_dependencies (task_id, depends_on_task_id, owner_id)
       values ($1, $2, $3)`,
      [firstTaskId, prerequisiteTaskId, USER_B_ID],
    ))).rejects.toThrow();
  });

  it('applies a template atomically with its checklist and only exposes it to its owner', async () => {
    const ownTemplate = await asUser(db, USER_A_ID, async () => db.query(
      'select name from public.task_templates where id = $1',
      [templateId],
    ));
    const otherTemplate = await asUser(db, USER_B_ID, async () => db.query(
      'select id from public.task_templates where id = $1',
      [templateId],
    ));
    expect(ownTemplate.rows).toEqual([{ name: 'ตรวจ Backup ทุกเดือน' }]);
    expect(otherTemplate.rows).toHaveLength(0);

    const applied = await asUser(db, USER_A_ID, async () => db.query(
      'select public.apply_task_template($1, $2::date, null::date, $3) as result',
      [templateId, '2026-09-15', 'ต้องทำ'],
    ));
    const createdId = (applied.rows[0] as { result: { id: string } }).result.id;
    const created = await asUser(db, USER_A_ID, async () => db.query(
      `select title, start_date::text, due_date::text, estimate_hours, recurrence from public.personal_tasks where id = $1`,
      [createdId],
    ));
    const subtasks = await asUser(db, USER_A_ID, async () => db.query(
      'select title, due_date::text, sort_order from public.task_subtasks where task_id = $1 order by sort_order',
      [createdId],
    ));
    expect(created.rows).toEqual([{ title: 'ตรวจสอบ Backup ประจำเดือน', start_date: '2026-09-15', due_date: '2026-09-17', estimate_hours: '3.50', recurrence: 'รายเดือน' }]);
    expect(subtasks.rows).toEqual([
      { title: 'ตรวจผลสำรองข้อมูล', due_date: '2026-09-17', sort_order: 0 },
      { title: 'บันทึกผลการตรวจ', due_date: '2026-09-17', sort_order: 1 },
    ]);
  });

  it('keeps operational record links private to the task owner', async () => {
    const recordId = '00000000-0000-0000-0000-0000000000e1';
    await asServiceRole(db, async () => db.query(
      `insert into public.task_record_links (task_id, owner_id, record_type, record_id, record_code, record_title, record_status)
       values ($1, $2, 'incident', $3, 'INC-0001', 'ทดสอบ Incident', 'เปิด')`,
      [firstTaskId, USER_A_ID, recordId],
    ));
    const own = await asUser(db, USER_A_ID, async () => db.query('select record_code from public.task_record_links'));
    const other = await asUser(db, USER_B_ID, async () => db.query('select record_code from public.task_record_links'));
    expect(own.rows).toEqual([{ record_code: 'INC-0001' }]);
    expect(other.rows).toHaveLength(0);
  });
});
