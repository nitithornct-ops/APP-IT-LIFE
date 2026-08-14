import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

/**
 * 20260908100000_tighten_directory_access.sql
 *
 * การทดสอบเจาะระบบจริง (Pre-production QA audit 2026-08-13) พบว่าบัญชีที่ไม่มี role และไม่มี
 * permission ใดเลย อ่านทะเบียนพนักงานทั้งองค์กรได้ครบทุกฟิลด์ และอ่าน profiles ของทุกคนได้ทุกคอลัมน์
 * ทั้งผ่าน API และผ่าน PostgREST ตรง เทสต์ชุดนี้ยึดพฤติกรรมใหม่ไว้ไม่ให้ถอยกลับ
 */

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1';
const NO_ROLE_ID = '00000000-0000-0000-0000-0000000000a2';
const OTHER_USER_ID = '00000000-0000-0000-0000-0000000000a3';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();

  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email) values ($1,'dir-admin@test.local'), ($2,'dir-norole@test.local'), ($3,'dir-other@test.local')`,
      [ADMIN_ID, NO_ROLE_ID, OTHER_USER_ID],
    );
    await db.query(
      `insert into public.user_roles (user_id, role_id) select $1, id from public.roles where key = 'super_admin'`,
      [ADMIN_ID],
    );
    await db.query(`update public.profiles set phone = '0800000001' where id = $1`, [NO_ROLE_ID]);
    await db.query(`update public.profiles set phone = '0800000002' where id = $1`, [OTHER_USER_ID]);
    await db.query(
      `insert into public.employees (employee_code, first_name_th, last_name_th, email, username_ad, upn, notes)
       values ('DIR-001','ทดสอบ','ทะเบียน','dir1@test.local','dir.one','dir.one@life.local','ข้อมูลลับ')
       on conflict do nothing`,
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('employees register', () => {
  it('returns nothing to a user with no permissions', async () => {
    const result = await asUser(db, NO_ROLE_ID, async () => db.query('select * from public.employees'));
    expect(result.rows).toHaveLength(0);
  });

  it('still returns the full record to a user holding employee.manage', async () => {
    const result = await asUser(db, ADMIN_ID, async () =>
      db.query<{ notes: string | null; upn: string | null }>('select notes, upn from public.employees'),
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    expect(result.rows[0].notes).toBe('ข้อมูลลับ');
  });
});

describe('profiles column privileges', () => {
  it('lets any signed-in user read the internal directory columns', async () => {
    const result = await asUser(db, NO_ROLE_ID, async () =>
      db.query('select id, full_name, email, department_id, status from public.profiles'),
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses to hand a phone number to a signed-in user', async () => {
    await expect(
      asUser(db, NO_ROLE_ID, async () => db.query('select phone from public.profiles')),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses `select *` because that would include the withheld columns', async () => {
    await expect(
      asUser(db, NO_ROLE_ID, async () => db.query('select * from public.profiles')),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('my_profile()', () => {
  it('gives a user their own phone number back', async () => {
    const result = await asUser(db, NO_ROLE_ID, async () =>
      db.query<{ id: string; phone: string | null }>('select id, phone from public.my_profile()'),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe(NO_ROLE_ID);
    expect(result.rows[0].phone).toBe('0800000001');
  });

  it('never returns another user, whoever calls it', async () => {
    const result = await asUser(db, NO_ROLE_ID, async () =>
      db.query<{ id: string }>('select id from public.my_profile()'),
    );
    expect(result.rows.map((row) => row.id)).toEqual([NO_ROLE_ID]);
  });

  it('scopes itself to the caller even for an administrator', async () => {
    const result = await asUser(db, ADMIN_ID, async () =>
      db.query<{ id: string; phone: string | null }>('select id, phone from public.my_profile()'),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe(ADMIN_ID);
  });
});
