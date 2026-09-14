import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, createTestDb } from './testDb';

const LICENSE_ID = '00000000-0000-0000-0000-000000000101';
const EMPLOYEE_ID = '00000000-0000-0000-0000-000000000102';
const ASSET_ID = '00000000-0000-0000-0000-000000000103';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into public.employees (id, employee_code, first_name_th, last_name_th)
       values ($1, 'LIC-TEST-EMP', 'License', 'User')`,
      [EMPLOYEE_ID],
    );
    await db.query(
      `insert into public.assets (id, asset_code, name)
       values ($1, 'LIC-TEST-DEV', 'License Test Device')`,
      [ASSET_ID],
    );
    await db.query(
      `insert into public.software_licenses (id, software_name, product_name, license_code, total_qty, used_qty)
       values ($1, 'License Test', 'License Test', 'LIC-TEST-001', 2, 0)`,
      [LICENSE_ID],
    );
  });
});

afterAll(async () => {
  await db.close();
});

describe('software license allocation migration', () => {
  it('assigns to a user and device, then preserves reclaim history', async () => {
    await asServiceRole(db, async () => {
      const userResult = await db.query<{ id: string; status: string }>(
        `select id, status from public.assign_software_license($1, 'user', $2, null, null, null)`,
        [LICENSE_ID, EMPLOYEE_ID],
      );
      const deviceResult = await db.query<{ id: string; status: string }>(
        `select id, status from public.assign_software_license($1, 'device', null, $2, null, null)`,
        [LICENSE_ID, ASSET_ID],
      );

      expect(userResult.rows[0]).toMatchObject({ id: expect.any(String), status: 'assigned' });
      expect(deviceResult.rows[0]).toMatchObject({ id: expect.any(String), status: 'assigned' });

      const reclaimed = await db.query<{ status: string; reclaimed_at: string | null }>(
        `select status, reclaimed_at from public.reclaim_software_license($1, $2, 'returned', null)`,
        [LICENSE_ID, userResult.rows[0].id],
      );
      expect(reclaimed.rows[0].status).toBe('reclaimed');
      expect(reclaimed.rows[0].reclaimed_at).not.toBeNull();
    });
  });

  it('rejects a user allocation with a device target', async () => {
    await expect(asServiceRole(db, () => db.query(
      `select * from public.assign_software_license($1, 'user', null, $2, null, null)`,
      [LICENSE_ID, ASSET_ID],
    ))).rejects.toThrow('ALLOCATION_TARGET_INVALID');
  });
});
