import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const USER_A_ID = '00000000-0000-0000-0000-0000000000c1';
const USER_B_ID = '00000000-0000-0000-0000-0000000000c2';
let db: PGlite;
let taskId: string;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
      USER_A_ID, 'task-reminder-a@test.local', USER_B_ID, 'task-reminder-b@test.local',
    ]);
  });
  const task = await asUser(db, USER_A_ID, async () => db.query(
    `insert into public.personal_tasks (owner_id, title, due_date, due_time)
     values ($1, 'ตรวจ Backup', '2026-08-11', '09:00') returning id`,
    [USER_A_ID],
  ));
  taskId = (task.rows[0] as { id: string }).id;
});

afterAll(async () => db.close());

describe('task reminder privacy and delivery', () => {
  it('allows only the task owner to create and read the reminder', async () => {
    await asUser(db, USER_A_ID, async () => db.query(
      `insert into public.task_reminders (task_id, owner_id, remind_at, preset)
       values ($1, $2, '2026-08-11T01:30:00Z', 'before_30m')`,
      [taskId, USER_A_ID],
    ));

    const own = await asUser(db, USER_A_ID, async () => db.query('select preset from public.task_reminders'));
    const other = await asUser(db, USER_B_ID, async () => db.query('select preset from public.task_reminders'));
    expect(own.rows).toEqual([{ preset: 'before_30m' }]);
    expect(other.rows).toHaveLength(0);

    await expect(asUser(db, USER_B_ID, async () => db.query(
      `insert into public.task_reminders (task_id, owner_id, remind_at, preset)
       values ($1, $2, '2026-08-11T01:30:00Z', 'before_30m')`,
      [taskId, USER_B_ID],
    ))).rejects.toThrow();
  });

  it('dispatches a due reminder exactly once into the existing notification center', async () => {
    const first = await asServiceRole(db, async () => db.query(
      `select public.dispatch_due_task_reminders('2026-08-11T01:31:00Z') as delivered`,
    ));
    const second = await asServiceRole(db, async () => db.query(
      `select public.dispatch_due_task_reminders('2026-08-11T01:32:00Z') as delivered`,
    ));
    expect((first.rows[0] as { delivered: number }).delivered).toBe(1);
    expect((second.rows[0] as { delivered: number }).delivered).toBe(0);

    const notifications = await asUser(db, USER_A_ID, async () => db.query(
      `select type, title from public.notifications where type = 'task_reminder'`,
    ));
    expect(notifications.rows).toEqual([{ type: 'task_reminder', title: 'เตือนงาน: ตรวจ Backup' }]);
  });
});
