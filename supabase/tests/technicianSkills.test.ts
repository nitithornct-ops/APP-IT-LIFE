import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

/**
 * 20260916100000_technician_skill_matrix.sql
 *
 * ระดับทักษะเป็นผลประเมินรายบุคคลที่ใช้ตัดสินการมอบหมายงาน สองข้อที่ห้ามพลาดคือ
 * (1) คนที่ไม่มีสิทธิ์ต้องไม่เห็นผลประเมินของคนอื่น และ (2) ผู้ถูกประเมินต้องแก้ระดับของตัวเองไม่ได้
 * เทสต์ชุดนี้ยึดทั้งสองข้อไว้ พร้อมกับกติกา "ไม่มีแถว = ยังไม่ประเมิน" (ไม่มีระดับ 0)
 */

const ADMIN_ID = '00000000-0000-0000-0000-0000000000b1';
const MANAGER_ID = '00000000-0000-0000-0000-0000000000b2';
const TECHNICIAN_ID = '00000000-0000-0000-0000-0000000000b3';
const NO_ROLE_ID = '00000000-0000-0000-0000-0000000000b4';

let db: PGlite;
let categoryId: string;

beforeAll(async () => {
  db = await createTestDb();

  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email) values
         ($1,'skill-admin@test.local'), ($2,'skill-manager@test.local'),
         ($3,'skill-tech@test.local'), ($4,'skill-norole@test.local')`,
      [ADMIN_ID, MANAGER_ID, TECHNICIAN_ID, NO_ROLE_ID],
    );
    for (const [userId, roleKey] of [[ADMIN_ID, 'super_admin'], [MANAGER_ID, 'manager'], [TECHNICIAN_ID, 'technician']] as const) {
      await db.query(`insert into public.user_roles (user_id, role_id) select $1, id from public.roles where key = $2`, [userId, roleKey]);
    }

    const category = await db.query<{ id: string }>(
      `insert into public.ticket_categories (name) values ('เครือข่ายทดสอบทักษะ') returning id`,
    );
    categoryId = category.rows[0].id;

    await db.query(
      `insert into public.technician_skills (technician_id, category_id, level, note) values ($1, $2, 3, 'ดูแล Core Switch')`,
      [TECHNICIAN_ID, categoryId],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('technician_skills read access', () => {
  it('returns nothing to a user with no permissions', async () => {
    const result = await asUser(db, NO_ROLE_ID, async () => db.query('select * from public.technician_skills'));
    expect(result.rows).toHaveLength(0);
  });

  it('returns nothing to a visitor who is not logged in', async () => {
    const result = await asAnon(db, async () => db.query('select * from public.technician_skills'));
    expect(result.rows).toHaveLength(0);
  });

  it('lets the assessed technician read their own record', async () => {
    const result = await asUser(db, TECHNICIAN_ID, async () =>
      db.query<{ level: number }>('select level from public.technician_skills'),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].level).toBe(3);
  });

  it('lets a manager holding technician_skill.view read the whole matrix', async () => {
    const allowed = await asUser(db, MANAGER_ID, async () =>
      db.query<{ has_permission: boolean }>(`select public.has_permission('technician_skill.view') as has_permission`),
    );
    expect(allowed.rows[0].has_permission).toBe(true);

    const result = await asUser(db, MANAGER_ID, async () => db.query('select * from public.technician_skills'));
    expect(result.rows).toHaveLength(1);
  });
});

describe('technician_skills write access', () => {
  it('stops a technician from grading themselves', async () => {
    // RLS ตัดแถวออกจาก UPDATE เงียบ ๆ (ไม่ error) จึงต้องยืนยันทั้งจำนวนแถวที่โดนแก้และค่าที่ยังอยู่
    const attempt = await asUser(db, TECHNICIAN_ID, async () =>
      db.query('update public.technician_skills set level = 1 where technician_id = $1', [TECHNICIAN_ID]),
    );
    expect(attempt.affectedRows).toBe(0);

    const stillThree = await asServiceRole(db, async () =>
      db.query<{ level: number }>('select level from public.technician_skills where technician_id = $1', [TECHNICIAN_ID]),
    );
    expect(stillThree.rows[0].level).toBe(3);
  });

  it('stops a technician from deleting their own assessment', async () => {
    const attempt = await asUser(db, TECHNICIAN_ID, async () =>
      db.query('delete from public.technician_skills where technician_id = $1', [TECHNICIAN_ID]),
    );
    expect(attempt.affectedRows).toBe(0);
  });

  it('stops a manager who may only view from recording an assessment', async () => {
    await expect(
      asUser(db, MANAGER_ID, async () =>
        db.query('insert into public.technician_skills (technician_id, category_id, level) values ($1, $2, 2)', [MANAGER_ID, categoryId]),
      ),
    ).rejects.toThrow();
  });

  it('lets a holder of technician_skill.manage record and withdraw an assessment', async () => {
    await asUser(db, ADMIN_ID, async () =>
      db.query('insert into public.technician_skills (technician_id, category_id, level) values ($1, $2, 2)', [ADMIN_ID, categoryId]),
    );
    const saved = await asUser(db, ADMIN_ID, async () =>
      db.query<{ level: number }>('select level from public.technician_skills where technician_id = $1', [ADMIN_ID]),
    );
    expect(saved.rows[0].level).toBe(2);

    // ถอนผลประเมินคือการลบแถว ไม่ใช่ตั้งค่าเป็น 0 — ตารางกลับไปเป็น "ยังไม่ประเมิน"
    await asUser(db, ADMIN_ID, async () => db.query('delete from public.technician_skills where technician_id = $1', [ADMIN_ID]));
    const removed = await asUser(db, ADMIN_ID, async () =>
      db.query('select 1 from public.technician_skills where technician_id = $1', [ADMIN_ID]),
    );
    expect(removed.rows).toHaveLength(0);
  });
});

describe('technician_skills data rules', () => {
  it('accepts only levels 1-3', async () => {
    for (const level of [0, 4]) {
      await expect(
        asServiceRole(db, async () =>
          db.query('insert into public.technician_skills (technician_id, category_id, level) values ($1, $2, $3)', [MANAGER_ID, categoryId, level]),
        ),
      ).rejects.toThrow();
    }
  });

  it('keeps one assessment per technician per category', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query('insert into public.technician_skills (technician_id, category_id, level) values ($1, $2, 1)', [TECHNICIAN_ID, categoryId]),
      ),
    ).rejects.toThrow();
  });

  it('drops assessments when the category is removed so no orphan level survives', async () => {
    await asServiceRole(db, async () => {
      const category = await db.query<{ id: string }>(`insert into public.ticket_categories (name) values ('หมวดชั่วคราว') returning id`);
      const temporaryId = category.rows[0].id;
      await db.query('insert into public.technician_skills (technician_id, category_id, level) values ($1, $2, 2)', [MANAGER_ID, temporaryId]);
      await db.query('delete from public.ticket_categories where id = $1', [temporaryId]);
      const remaining = await db.query('select 1 from public.technician_skills where category_id = $1', [temporaryId]);
      expect(remaining.rows).toHaveLength(0);
    });
  });
});
