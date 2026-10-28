import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

let db: PGlite;
const problem = '00000000-0000-4000-8000-000000009001';
const ci1 = '00000000-0000-4000-8000-000000009002';
const ci2 = '00000000-0000-4000-8000-000000009003';
const missing = '00000000-0000-4000-8000-000000009004';
const user = '00000000-0000-4000-8000-000000009005';
const change = '00000000-0000-4000-8000-000000009006';
const tester = '00000000-0000-4000-8000-000000009007';
const approver = '00000000-0000-4000-8000-000000009008';

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query("insert into auth.users(id,email) values ($1,'problem-atomic@test.local'),($2,'problem-tester@test.local'),($3,'problem-approver@test.local')", [user, tester, approver]);
    await db.query(`insert into public.problems(id, problem_number, title) values ($1, 'PRB-ATOMIC-TEST', 'Original')`, [problem]);
    await db.query(`insert into public.configuration_items(id, ci_code, name, ci_type, environment) values
      ($1, 'CI-ATOMIC-1', 'CI one', 'Other', 'N/A'), ($2, 'CI-ATOMIC-2', 'CI two', 'Other', 'N/A')`, [ci1, ci2]);
    await db.query('insert into public.problem_configuration_items(problem_id, ci_id) values ($1, $2)', [problem, ci1]);
  });
});
afterAll(async () => { await db.close(); });

const call = `select public.update_problem_atomic($1, $2::jsonb, null, null, array[$3::uuid], null, null, null, 'test')`;
async function state() {
  return asServiceRole(db, async () => {
    const result = await db.query<{ title: string; ci_id: string }>(
      'select p.title, c.ci_id from public.problems p join public.problem_configuration_items c on c.problem_id = p.id where p.id = $1', [problem]);
    return result.rows;
  });
}

describe('atomic Problem update', () => {
  it('rolls back deleted links and the main row when a linked ID is invalid', async () => {
    await expect(asServiceRole(db, () => db.query(call, [problem, JSON.stringify({ title: 'Changed' }), missing]))).rejects.toThrow();
    expect(await state()).toEqual([{ title: 'Original', ci_id: ci1 }]);
  });

  it('rolls back replaced links when the main update violates a constraint', async () => {
    await expect(asServiceRole(db, () => db.query(call, [problem, JSON.stringify({ title: 'x'.repeat(201) }), ci2]))).rejects.toThrow();
    expect(await state()).toEqual([{ title: 'Original', ci_id: ci1 }]);
  });

  it('rolls back the update and links if the audit insert fails', async () => {
    await db.exec(`create function public.test_reject_problem_audit() returns trigger language plpgsql as $$
      begin if new.target_id = '${problem}' then raise exception 'test audit failure'; end if; return new; end $$;
      create trigger test_reject_problem_audit before insert on public.audit_logs
      for each row execute function public.test_reject_problem_audit();`);
    try {
      await expect(asServiceRole(db, () => db.query(call, [problem, JSON.stringify({ title: 'Changed' }), ci2]))).rejects.toThrow('test audit failure');
      expect(await state()).toEqual([{ title: 'Original', ci_id: ci1 }]);
    } finally {
      await db.exec('drop trigger test_reject_problem_audit on public.audit_logs; drop function public.test_reject_problem_audit();');
    }
  });

  it('commits the row, links and audit together', async () => {
    await asServiceRole(db, () => db.query(call, [problem, JSON.stringify({ title: 'Changed' }), ci2]));
    expect(await state()).toEqual([{ title: 'Changed', ci_id: ci2 }]);
    const audits = await asServiceRole(db, () => db.query<{ detail: { changes: Record<string, { from: string; to: string }> } }>(
      "select detail from public.audit_logs where target_table = 'problems' and target_id = $1 and action = 'UPDATE'", [problem]));
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].detail.changes.title).toEqual({ from: '[REDACTED]', to: '[REDACTED]' });
  });

  it('does not allow authenticated users to invoke the service-only RPC', async () => {
    await expect(asUser(db, '00000000-0000-4000-8000-000000000001', () => db.query(call, [problem, '{}', ci1]))).rejects.toThrow();
  });

  it('verifies only a deployed linked Change and clears verification when links change', async () => {
    const verify = 'select public.verify_problem_change_atomic($1, $2, $3, $4, $5)';
    await expect(asServiceRole(db, () => db.query(verify, [problem, user, 'problem-atomic@test.local', 'checked', 'test']))).rejects.toThrow('PROBLEM_DEPLOYED_CHANGE_REQUIRED');
    await asServiceRole(db, async () => {
      await db.query(`insert into public.change_requests(id, change_number, title, system_affected, description, requester_id)
        values ($1, 'CHG-ATOMIC', 'Change', 'System', 'Description', $2)`, [change, user]);
      await db.query("update public.change_requests set status = 'ผ่านการทดสอบ', test_result = 'pass', test_passed = true, test_signoff_by = $2, test_signoff_at = now() where id = $1", [change, tester]);
      await db.query("update public.change_requests set status = 'อนุมัติแล้ว', approver_id = $2, approve_date = now(), approve_result = 'อนุมัติ' where id = $1", [change, approver]);
      await db.query("update public.change_requests set status = 'ติดตั้งใช้งานแล้ว', deploy_by = $2, deploy_date = now(), version = '1' where id = $1", [change, tester]);
      await db.query('insert into public.problem_changes(problem_id, change_id) values ($1, $2)', [problem, change]);
      await db.query(verify, [problem, user, 'problem-atomic@test.local', 'checked', 'test']);
      const verified = await db.query<{ change_verified_by: string }>('select change_verified_by from public.problems where id = $1', [problem]);
      expect(verified.rows[0].change_verified_by).toBe(user);
      await db.query("select public.update_problem_atomic($1, '{}'::jsonb, null, null, null, '{}'::uuid[], $2, null, 'test')", [problem, user]);
      const cleared = await db.query<{ change_verified_by: string | null }>('select change_verified_by from public.problems where id = $1', [problem]);
      expect(cleared.rows[0].change_verified_by).toBeNull();
    });
  });
});
