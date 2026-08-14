import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

/**
 * 20260909100000_governance_health_snapshot.sql
 *
 * ปุ่ม "ตรวจสุขภาพระบบ" ในโมดูล Governance เคยบันทึกผล PASS ตายตัวโดยไม่ตรวจอะไรเลย
 * ฟังก์ชันนี้คือแหล่งข้อมูลจริงที่ผลการตรวจต้องอ้างอิง — ต้องอ่านสถานะ RLS ได้จริง
 * และต้องเรียกได้เฉพาะผู้ที่มีสิทธิ์ operations.manage
 */

const ADMIN_ID = '00000000-0000-0000-0000-0000000000b1';
const NO_ROLE_ID = '00000000-0000-0000-0000-0000000000b2';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users (id, email) values ($1,'ops-admin@test.local'), ($2,'ops-norole@test.local')`, [
      ADMIN_ID,
      NO_ROLE_ID,
    ]);
    await db.query(`insert into public.user_roles (user_id, role_id) select $1, id from public.roles where key = 'super_admin'`, [
      ADMIN_ID,
    ]);
  });
});

afterAll(async () => {
  await db?.close();
});

describe('governance_health_snapshot()', () => {
  it('refuses a caller without operations.manage', async () => {
    await expect(
      asUser(db, NO_ROLE_ID, async () => db.query('select public.governance_health_snapshot()')),
    ).rejects.toThrow(/ไม่มีสิทธิ์|permission/i);
  });

  it('reports the real RLS coverage of the schema, not a hard-coded value', async () => {
    const result = await asUser(db, ADMIN_ID, async () =>
      db.query<{ governance_health_snapshot: Record<string, never> }>('select public.governance_health_snapshot()'),
    );

    const snapshot = result.rows[0].governance_health_snapshot as unknown as {
      rls: { totalTables: number; enabledTables: number; unprotectedTables: string[]; policyCount: number };
      settings: { requiredPresent: number; requiredExpected: number };
      database: { reachable: boolean };
    };

    expect(snapshot.database.reachable).toBe(true);
    expect(snapshot.rls.totalTables).toBeGreaterThan(50);
    expect(snapshot.rls.policyCount).toBeGreaterThan(50);
    // ทุกตารางในสคีมา public ต้องเปิด RLS ครบ ไม่มีข้อยกเว้น
    expect(snapshot.rls.unprotectedTables).toEqual([]);
    expect(snapshot.rls.enabledTables).toBe(snapshot.rls.totalTables);
    expect(snapshot.settings.requiredExpected).toBe(4);
  });

  it('notices a table that has RLS turned off', async () => {
    // สร้างด้วย role เจ้าของสคีมา (ไม่ใช่ service_role ซึ่งไม่มีสิทธิ์ CREATE ใน public)
    await db.exec('create table public.qa_unprotected (id uuid primary key default gen_random_uuid());');

    const result = await asUser(db, ADMIN_ID, async () =>
      db.query<{ governance_health_snapshot: Record<string, never> }>('select public.governance_health_snapshot()'),
    );
    const snapshot = result.rows[0].governance_health_snapshot as unknown as {
      rls: { unprotectedTables: string[]; totalTables: number; enabledTables: number };
    };

    expect(snapshot.rls.unprotectedTables).toContain('qa_unprotected');
    expect(snapshot.rls.enabledTables).toBeLessThan(snapshot.rls.totalTables);

    await db.exec('drop table public.qa_unprotected;');
  });
});
