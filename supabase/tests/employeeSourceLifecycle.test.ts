import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, createTestDb } from './testDb';

const EMPLOYEE_ID = '40000000-0000-0000-0000-000000000021';
const MANAGER_ID = '40000000-0000-0000-0000-000000000022';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into public.employees (id, employee_code, first_name_th, last_name_th, status)
       values ($1, 'EMP-MANAGER-SOURCE', 'Manager', 'Source', 'active')`,
      [MANAGER_ID],
    );
  });
});

afterAll(async () => db.close());

describe('Employee personnel source and lifecycle actions', () => {
  it('stores personnel fields independently from account data', async () => {
    const result = await asServiceRole(db, () => db.query<{
      id: string;
      manager_employee_id: string;
      start_date: string;
      end_date: string;
      employment_status: string;
      location: string;
    }>(
      `insert into public.employees
        (id, employee_code, first_name_th, last_name_th, manager_employee_id,
         start_date, end_date, employment_status, location, status)
       values ($1, 'EMP-SOURCE-001', 'Source', 'Employee', $2,
         '2026-01-01', '2026-12-31', 'contractor', 'Bangkok HQ', 'active')
       returning id, manager_employee_id, start_date::text, end_date::text, employment_status, location`,
      [EMPLOYEE_ID, MANAGER_ID],
    ));

    expect(result.rows[0]).toMatchObject({
      id: EMPLOYEE_ID,
      manager_employee_id: MANAGER_ID,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      employment_status: 'contractor',
      location: 'Bangkok HQ',
    });
  });

  it('creates one downstream action per lifecycle target and supports idempotent license reclaim', async () => {
    const event = await asServiceRole(db, () => db.query<{ id: string }>(
      `insert into public.employee_lifecycle_events
        (lifecycle_code, employee_id, employee_code, employee_name, event_type,
         effective_date, reason, status)
       values ('JML-SOURCE-001', $1, 'EMP-SOURCE-001', 'Source Employee',
         'LEAVER', '2026-12-31', 'Contract ended', 'PROCESSING')
       returning id`,
      [EMPLOYEE_ID],
    ));
    const eventId = event.rows[0].id;
    for (const targetType of ['user', 'access', 'asset', 'license', 'approval_group']) {
      await asServiceRole(db, () => db.query(
        `insert into public.employee_lifecycle_actions
          (lifecycle_event_id, target_type, status, affected_count, detail)
         values ($1, $2, 'PENDING', 0, '{}'::jsonb)`,
        [eventId, targetType],
      ));
    }

    const actions = await asServiceRole(db, () => db.query<{ count: string }>(
      'select count(*)::text as count from public.employee_lifecycle_actions where lifecycle_event_id = $1',
      [eventId],
    ));
    expect(actions.rows[0].count).toBe('5');

    const reclaimed = await asServiceRole(db, () => db.query<{ result: { count: number; employeeId: string } }>(
      'select public.reclaim_software_licenses_for_employee($1, null, $2) as result',
      [EMPLOYEE_ID, 'Contract ended'],
    ));
    expect(reclaimed.rows[0].result).toMatchObject({ count: 0, employeeId: EMPLOYEE_ID });
  });
});
