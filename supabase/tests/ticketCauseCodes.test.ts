import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

/**
 * 20260921100000_ticket_cause_codes.sql
 *
 * ทะเบียนสาเหตุเป็นข้อมูลหลักที่ช่างทุกคนต้องอ่านได้ แต่ต้องมีคนแก้ได้จำกัด ถ้าใครก็เพิ่มรหัสได้
 * ทะเบียนจะกลายเป็นข้อความอิสระอีกแบบหนึ่งภายในไม่กี่สัปดาห์ ซึ่งพังจุดประสงค์ทั้งหมดของตาราง
 *
 * อีกข้อที่ยึดไว้คือการเลิกใช้รหัสต้องไม่ทำให้ใบงานเก่าเสียหาย — ปิดใช้ได้ ลบแล้วใบงานไม่หาย
 */

const ADMIN_ID = '00000000-0000-0000-0000-0000000000c1';
const TECHNICIAN_ID = '00000000-0000-0000-0000-0000000000c2';

let db: PGlite;
let categoryId: string;
let causeCodeId: string;

beforeAll(async () => {
  db = await createTestDb();

  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email) values ($1,'cause-admin@test.local'), ($2,'cause-tech@test.local')`,
      [ADMIN_ID, TECHNICIAN_ID],
    );
    for (const [userId, roleKey] of [[ADMIN_ID, 'super_admin'], [TECHNICIAN_ID, 'technician']] as const) {
      await db.query('insert into public.user_roles (user_id, role_id) select $1, id from public.roles where key = $2', [userId, roleKey]);
    }

    const category = await db.query<{ id: string }>(
      "insert into public.ticket_categories (name) values ('เครือข่ายทดสอบสาเหตุ') returning id",
    );
    categoryId = category.rows[0].id;

    const cause = await db.query<{ id: string }>(
      `insert into public.ticket_cause_codes (code, name, category_id, sort_order)
       values ('NET_CABLE', 'สายสัญญาณหลุดหรือชำรุด', $1, 10) returning id`,
      [categoryId],
    );
    causeCodeId = cause.rows[0].id;
  });
});

afterAll(async () => {
  await db?.close();
});

describe('อ่านทะเบียนสาเหตุ', () => {
  it('ช่างอ่านได้ทั้งที่ไม่มีสิทธิ์ cause_code.manage', async () => {
    const result = await asUser(db, TECHNICIAN_ID, async () =>
      db.query('select code from public.ticket_cause_codes'),
    );
    expect(result.rows).toHaveLength(1);
  });

  it('ผู้ที่ยังไม่ล็อกอินอ่านไม่ได้', async () => {
    const result = await asAnon(db, async () => db.query('select * from public.ticket_cause_codes'));
    expect(result.rows).toHaveLength(0);
  });
});

describe('แก้ทะเบียนสาเหตุ', () => {
  it('ช่างเพิ่มรหัสใหม่ไม่ได้', async () => {
    await expect(
      asUser(db, TECHNICIAN_ID, async () =>
        db.query("insert into public.ticket_cause_codes (code, name) values ('TECH_ADDED', 'ช่างเพิ่มเอง')"),
      ),
    ).rejects.toThrow();
  });

  it('ช่างแก้ชื่อรหัสเดิมไม่ได้ และค่าเดิมต้องไม่เปลี่ยน', async () => {
    const attempt = await asUser(db, TECHNICIAN_ID, async () =>
      db.query("update public.ticket_cause_codes set name = 'เปลี่ยนเอง' where code = 'NET_CABLE'"),
    );
    expect(attempt.affectedRows).toBe(0);

    const after = await asServiceRole(db, async () =>
      db.query<{ name: string }>("select name from public.ticket_cause_codes where code = 'NET_CABLE'"),
    );
    expect(after.rows[0].name).toBe('สายสัญญาณหลุดหรือชำรุด');
  });

  it('ผู้ดูแลเพิ่มและปิดใช้รหัสได้', async () => {
    await asUser(db, ADMIN_ID, async () =>
      db.query("insert into public.ticket_cause_codes (code, name) values ('USER_ERROR', 'ผู้ใช้ใช้งานไม่ถูกวิธี')"),
    );
    const disabled = await asUser(db, ADMIN_ID, async () =>
      db.query("update public.ticket_cause_codes set is_active = false where code = 'USER_ERROR'"),
    );
    expect(disabled.affectedRows).toBe(1);
  });
});

describe('รูปแบบรหัส', () => {
  it('ปฏิเสธรหัสตัวพิมพ์เล็กและอักขระที่จัดกลุ่มไม่ได้', async () => {
    for (const bad of ['net cable', 'net_cable', 'ก-ข', '_LEADING']) {
      await expect(
        asServiceRole(db, async () =>
          db.query('insert into public.ticket_cause_codes (code, name) values ($1, $2)', [bad, 'ทดสอบ']),
        ),
      ).rejects.toThrow();
    }
  });

  it('ห้ามรหัสซ้ำ', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query("insert into public.ticket_cause_codes (code, name) values ('NET_CABLE', 'ซ้ำ')"),
      ),
    ).rejects.toThrow();
  });
});

describe('ผลกับใบงาน', () => {
  it('ลบรหัสสาเหตุแล้วใบงานยังอยู่ และข้อความที่ช่างพิมพ์ไว้ไม่หาย', async () => {
    const ticketId = await asServiceRole(db, async () => {
      const requester = await db.query<{ id: string }>('select id from public.profiles limit 1');
      const ticket = await db.query<{ id: string }>(
        `insert into public.tickets (ticket_no, title, description, category_id, requester_id, cause_code_id, root_cause, status)
         values ('TK-CAUSE-0001', 'ทดสอบรหัสสาเหตุ', 'รายละเอียด', $1, $2, $3, 'สายที่ port 12 หลุดจากการย้ายโต๊ะ', 'ปิดงาน')
         returning id`,
        [categoryId, requester.rows[0].id, causeCodeId],
      );
      return ticket.rows[0].id;
    });

    await asServiceRole(db, async () =>
      db.query('delete from public.ticket_cause_codes where id = $1', [causeCodeId]),
    );

    const after = await asServiceRole(db, async () =>
      db.query<{ cause_code_id: string | null; root_cause: string | null }>(
        'select cause_code_id, root_cause from public.tickets where id = $1',
        [ticketId],
      ),
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].cause_code_id).toBeNull();
    // ข้อความอิสระคือหลักฐานที่เหลืออยู่เมื่อรหัสถูกลบ จึงห้ามหายไปพร้อมกัน
    expect(after.rows[0].root_cause).toBe('สายที่ port 12 หลุดจากการย้ายโต๊ะ');
  });
});
