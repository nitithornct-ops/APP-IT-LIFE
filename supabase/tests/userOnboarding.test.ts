import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

/**
 * 20260918100000_user_onboarding_state.sql
 *
 * การ์ด "เริ่มใช้ครั้งแรก" จะใช้ได้ก็ต่อเมื่อสถานะถูกเก็บจริง เทสต์ชุดนี้ยึดสามข้อ:
 * ผู้ใช้ปิดของตัวเองได้, ปิดของคนอื่นไม่ได้, และ my_profile() คืนสถานะกลับมาให้หน้าเว็บอ่านได้
 */

const USER_ID = '00000000-0000-0000-0000-0000000000f1';
const OTHER_ID = '00000000-0000-0000-0000-0000000000f2';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(
      `insert into auth.users (id, email) values ($1,'onboard@test.local'), ($2,'other@test.local')`,
      [USER_ID, OTHER_ID],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('onboarding state', () => {
  it('starts empty so a brand new account still sees the card', async () => {
    const result = await asUser(db, USER_ID, async () =>
      db.query<{ onboarding_completed_at: string | null; onboarding_dismissed_at: string | null }>(
        'select onboarding_completed_at, onboarding_dismissed_at from public.my_profile()',
      ),
    );
    expect(result.rows[0].onboarding_completed_at).toBeNull();
    expect(result.rows[0].onboarding_dismissed_at).toBeNull();
  });

  it('records "skipped" separately from "finished"', async () => {
    const skipped = await asUser(db, USER_ID, async () =>
      db.query<{ onboarding_completed_at: string | null; onboarding_dismissed_at: string | null }>(
        'select * from public.set_my_onboarding_state(true)',
      ),
    );
    expect(skipped.rows[0].onboarding_dismissed_at).not.toBeNull();
    expect(skipped.rows[0].onboarding_completed_at).toBeNull();

    const finished = await asUser(db, USER_ID, async () =>
      db.query<{ onboarding_completed_at: string | null; onboarding_dismissed_at: string | null }>(
        'select * from public.set_my_onboarding_state(false)',
      ),
    );
    expect(finished.rows[0].onboarding_completed_at).not.toBeNull();
    // การกดข้ามครั้งก่อนต้องไม่ถูกลบทิ้ง
    expect(finished.rows[0].onboarding_dismissed_at).not.toBeNull();
  });

  it('surfaces the saved state through my_profile so the card stays closed', async () => {
    const result = await asUser(db, USER_ID, async () =>
      db.query<{ onboarding_completed_at: string | null }>('select onboarding_completed_at from public.my_profile()'),
    );
    expect(result.rows[0].onboarding_completed_at).not.toBeNull();
  });

  it('only ever touches the caller\'s own row', async () => {
    await asUser(db, OTHER_ID, async () => db.query('select * from public.set_my_onboarding_state(true)'));

    const other = await asServiceRole(db, async () =>
      db.query<{ onboarding_dismissed_at: string | null; onboarding_completed_at: string | null }>(
        'select onboarding_dismissed_at, onboarding_completed_at from public.profiles where id = $1',
        [OTHER_ID],
      ),
    );
    expect(other.rows[0].onboarding_dismissed_at).not.toBeNull();
    // ของคนที่สองต้องไม่ถูกทำเครื่องหมายว่าดูครบ ทั้งที่คนแรกเคยกดไปแล้ว
    expect(other.rows[0].onboarding_completed_at).toBeNull();
  });

  it('refuses to run for a visitor who is not signed in', async () => {
    await expect(
      db.query('select * from public.set_my_onboarding_state(true)'),
    ).rejects.toThrow(/ONBOARDING_NOT_AUTHENTICATED/);
  });
});
