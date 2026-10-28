import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

let db: PGlite;
const author = '00000000-0000-4000-8000-000000009101';
const outsider = '00000000-0000-4000-8000-000000009102';

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query("insert into auth.users(id,email) values ($1,'kb-author@test.local'),($2,'kb-outsider@test.local')", [author, outsider]);
    await db.query("insert into public.user_permission_overrides(user_id,permission_id,effect,reason,end_at) select $1,id,'allow','test',now() + interval '30 days' from public.permissions where key = 'knowledge.view'", [author]);
    await db.query(`insert into public.knowledge_articles(article_code,title,solution,author_id,status,published_at,search_rank,synonyms)
      select 'KB-20261027-' || lpad(i::text,4,'0'),
        case when i = 501 then 'Unique old result' else 'Common article' end,
        'Solution', $1, 'เผยแพร่', now(), case when i = 501 then 0 else 100 end,
        case when i = 501 then array['wireless-special'] else '{}'::text[] end
      from generate_series(1,501) as i`, [author]);
    await db.query(`insert into public.knowledge_articles(article_code,title,solution,author_id,status,published_at,expiry_date)
      values ('KB-20261027-0502','Expired secret result','Solution',$1,'เผยแพร่',now(),'2000-01-01')`, [author]);
  });
});
afterAll(async () => { await db.close(); });

const query = 'select id from public.search_knowledge_article_ids($1,null,null,null,$2,$3,30)';

it('finds a low-ranked older published article by title or synonym before applying the limit', async () => {
  const title = await asServiceRole(db, () => db.query(query, ['Unique old result', true, '2026-10-27']));
  const synonym = await asServiceRole(db, () => db.query(query, ['wireless-special', true, '2026-10-27']));
  expect(title.rows).toHaveLength(1);
  expect(synonym.rows).toEqual(title.rows);
  const permitted = await asUser(db, author, () => db.query(query, ['Unique old result', false, '2026-10-27']));
  expect(permitted.rows).toEqual(title.rows);
}, 60000);

it('excludes expired public results and respects internal row permissions', async () => {
  const expired = await asServiceRole(db, () => db.query(query, ['Expired secret', true, '2026-10-27']));
  expect(expired.rows).toHaveLength(0);
  const denied = await asUser(db, outsider, () => db.query(query, ['Unique old result', false, '2026-10-27']));
  expect(denied.rows).toHaveLength(0);
});
