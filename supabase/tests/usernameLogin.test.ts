import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asServiceRole, asUser, createTestDb } from './testDb';

/**
 * 20261013100000_username_login_accounts.sql
 *
 * บัญชีที่ไม่มีอีเมลจริงต้อง login ด้วยชื่อผู้ใช้ได้ โดยไม่เปิดช่องให้ไล่เดาว่าบัญชีใดมีอยู่จริง
 * เทสต์ชุดนี้จึงยึดสี่เรื่อง: ชื่อผู้ใช้ถูกเขียนพร้อมกำเนิดบัญชี, ห้ามซ้ำแม้ต่างตัวพิมพ์,
 * ค้นหาแล้วได้อีเมลที่ Supabase Auth ใช้จริง และคนที่ยังไม่ได้ login ต้องเรียกฟังก์ชันค้นหาไม่ได้
 */

const LOCAL_ID = '00000000-0000-0000-0000-0000000000a1';
const EMAIL_ID = '00000000-0000-0000-0000-0000000000a2';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    // บัญชีที่ผู้ดูแลสร้างให้แบบไม่มีอีเมลจริง — Worker ส่ง username มาทาง user_metadata
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, 'somchai.j@no-email.invalid', '{"full_name":"สมชาย ใจดี","username":"somchai.j"}'::jsonb)`,
      [LOCAL_ID],
    );
    // บัญชีที่เชิญด้วยอีเมลตามปกติ — ไม่มี key username ใน metadata
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, 'Malee@life.co.th', '{"full_name":"มาลี ดีใจ"}'::jsonb)`,
      [EMAIL_ID],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('username accounts', () => {
  it('writes the username in the same insert that creates the profile', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ username: string | null }>('select username from public.profiles where id = $1', [LOCAL_ID]),
    );
    expect(result.rows[0].username).toBe('somchai.j');
  });

  it('leaves the username empty for accounts invited by email', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ username: string | null }>('select username from public.profiles where id = $1', [EMAIL_ID]),
    );
    expect(result.rows[0].username).toBeNull();
  });

  it('refuses a second account with the same username in different letter case', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(
          `insert into auth.users (id, email, raw_user_meta_data)
           values (gen_random_uuid(), 'dup@no-email.invalid', '{"username":"SOMCHAI.J"}'::jsonb)`,
        ),
      ),
    ).rejects.toThrow(/profiles_username_unique_idx|duplicate key/i);
  });

  it('refuses a username with characters that make an identity ambiguous', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(
          `insert into auth.users (id, email, raw_user_meta_data)
           values (gen_random_uuid(), 'bad@no-email.invalid', '{"username":"some one"}'::jsonb)`,
        ),
      ),
    ).rejects.toThrow(/profiles_username_format/i);
  });

  it('shows the account owner their own username through my_profile', async () => {
    const result = await asUser(db, LOCAL_ID, async () =>
      db.query<{ username: string | null; onboarding_dismissed_at: string | null }>(
        'select username, onboarding_dismissed_at from public.my_profile()',
      ),
    );
    expect(result.rows[0].username).toBe('somchai.j');
  });

  it('keeps the username out of what one signed-in user can read about another', async () => {
    // เทียบชั้นเดียวกับ phone: อ่านข้ามผู้ใช้ไม่ได้แม้จะ login แล้ว (GRANT ระดับคอลัมน์)
    await expect(
      asUser(db, EMAIL_ID, async () => db.query('select username from public.profiles where id = $1', [LOCAL_ID])),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('resolve_login_email', () => {
  it('finds the internal email behind a username', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ email: string | null }>('select public.resolve_login_email($1) as email', ['somchai.j']),
    );
    expect(result.rows[0].email).toBe('somchai.j@no-email.invalid');
  });

  it('ignores letter case, so users are not locked out by their keyboard', async () => {
    const byUsername = await asServiceRole(db, async () =>
      db.query<{ email: string | null }>('select public.resolve_login_email($1) as email', ['Somchai.J']),
    );
    expect(byUsername.rows[0].email).toBe('somchai.j@no-email.invalid');

    // บัญชีที่เชิญด้วยอีเมลถูกบันทึกตัวพิมพ์ตามที่ผู้ดูแลกรอก ผู้ใช้จึงต้องพิมพ์ตัวเล็กแล้วยังเข้าได้
    const byEmail = await asServiceRole(db, async () =>
      db.query<{ email: string | null }>('select public.resolve_login_email($1) as email', ['malee@life.co.th']),
    );
    expect(byEmail.rows[0].email).toBe('Malee@life.co.th');
  });

  it('returns nothing for an identifier that belongs to no one', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ email: string | null }>('select public.resolve_login_email($1) as email', ['ghost']),
    );
    expect(result.rows[0].email).toBeNull();
  });

  /**
   * ข้อนี้คือหัวใจ: ถ้าวันหนึ่งมีคนเปลี่ยนการค้นหาไปใช้ LIKE/ilike หรือไปต่อสตริงตัวกรองของ PostgREST
   * การส่ง "%" หรือ "_" เข้ามาจะกลายเป็นไวลด์การ์ดที่ตรงกับแถวจริง แล้วคืนอีเมลของผู้ใช้คนอื่นออกไป
   * ให้คนที่ยังไม่ได้ login — ซึ่งทำลายกลไกที่ทำให้ "ไม่มีบัญชีนี้" กับ "รหัสผ่านผิด" แยกกันไม่ออก
   */
  it('treats wildcard characters as ordinary text, never as a pattern', async () => {
    for (const probe of ['%', '_', '%@%', "' or true --"]) {
      const result = await asServiceRole(db, async () =>
        db.query<{ email: string | null }>('select public.resolve_login_email($1) as email', [probe]),
      );
      expect(result.rows[0].email).toBeNull();
    }
  });

  it('cannot be called by a visitor who is not signed in, or by a signed-in user', async () => {
    await expect(
      asAnon(db, async () => db.query('select public.resolve_login_email($1)', ['somchai.j'])),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asUser(db, EMAIL_ID, async () => db.query('select public.resolve_login_email($1)', ['somchai.j'])),
    ).rejects.toThrow(/permission denied/i);
  });
});
