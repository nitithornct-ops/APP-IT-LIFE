import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ADMIN_ID = '00000000-0000-0000-0000-000000001801';
const USER_ID = '00000000-0000-0000-0000-000000001802';
let db: PGlite;
let articleId: string;

async function createUser(userId: string, email: string, role: string) {
  await asServiceRole(db, async () => {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [userId, email]);
    await db.query('insert into public.user_roles (user_id, role_id) select $1, id from public.roles where key = $2', [userId, role]);
  });
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(ADMIN_ID, 'knowledge-admin@test.local', 'super_admin');
  await createUser(USER_ID, 'knowledge-user@test.local', 'user');
  await asServiceRole(db, async () => {
    const result = await db.query<{ id: string }>(
      `insert into public.knowledge_articles
       (article_code, title, solution, status, author_id, article_owner_id, search_rank, synonyms, last_change_note, published_at)
       values ('KB-20261116-1801', 'แก้ Wi-Fi สำนักงาน', 'ปิดและเปิดอะแดปเตอร์ใหม่', 'เผยแพร่', $1, $1, 75, array['wifi', 'wi-fi', 'wireless'], 'สร้างบทความทดสอบ', now())
       returning id`,
      [ADMIN_ID],
    );
    articleId = result.rows[0].id;
  });
});

afterAll(async () => { await db.close(); });

describe('Knowledge Base governance P1', () => {
  it('creates a taxonomy mapping and an initial version snapshot', async () => {
    const result = await asServiceRole(db, () => db.query<{ taxonomy_count: number; version_count: number; synonyms: string[] }>(
      `select
         (select count(*)::int from public.knowledge_taxonomies) as taxonomy_count,
         (select count(*)::int from public.knowledge_article_versions where article_id = $1) as version_count,
         synonyms
       from public.knowledge_articles where id = $1`, [articleId],
    ));
    expect(result.rows[0].taxonomy_count).toBeGreaterThan(0);
    expect(result.rows[0].version_count).toBe(1);
    expect(result.rows[0].synonyms).toEqual(['wifi', 'wi-fi', 'wireless']);
  });

  it('increments version history when governed content changes', async () => {
    await asServiceRole(db, () => db.query(
      `update public.knowledge_articles
       set solution = 'เลือกเครือข่าย wireless ใหม่', last_change_note = 'ปรับขั้นตอนสำหรับผู้ใช้ทั่วไป'
       where id = $1`, [articleId],
    ));
    const result = await asServiceRole(db, () => db.query<{ version_number: number; change_note: string }>(
      'select version_number, change_note from public.knowledge_article_versions where article_id = $1 order by version_number', [articleId],
    ));
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].version_number).toBe(1);
    expect(result.rows[1].version_number).toBe(2);
    expect(result.rows[1].change_note).toBe('ปรับขั้นตอนสำหรับผู้ใช้ทั่วไป');
  });

  it('records not-helpful feedback only with a reason and deduplicates votes', async () => {
    const first = await asUser(db, USER_ID, () => db.query(
      'select * from public.mark_knowledge_article_not_helpful($1, $2)', [articleId, 'ข้อมูลล้าสมัย'],
    ));
    const duplicate = await asUser(db, USER_ID, () => db.query(
      'select * from public.mark_knowledge_article_not_helpful($1, $2)', [articleId, 'อื่น ๆ'],
    ));
    expect(first.rows).toEqual([{ not_helpful_count: 1, already_voted: false }]);
    expect(duplicate.rows).toEqual([{ not_helpful_count: 1, already_voted: true }]);
    await expect(asUser(db, USER_ID, () => db.query(
      'select * from public.mark_knowledge_article_not_helpful($1, $2)', [articleId, ''],
    ))).rejects.toThrow(/not-helpful reason is required/);
  });
});
