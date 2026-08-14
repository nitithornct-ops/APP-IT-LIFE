import type { ImportPlan, PendingAuthInvite, Ref, SqlOp } from './importPlan.js';
import { PHASE_ORDER } from './importPlan.js';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Real execution must go through the Supabase Admin API — auth.users is not a plain table an importer may INSERT into directly. */
export interface AuthAdmin {
  inviteUser(input: { email: string; fullName: string }): Promise<{ id: string }>;
}

export interface OperationFailure {
  table: string;
  legacySource: string;
  legacyId: string;
  error: string;
}

export interface ExecutionResult {
  inserted: number;
  failed: OperationFailure[];
  authInvited: number;
  authFailed: OperationFailure[];
}

type IdMap = Map<string, string>;
const idKey = (table: string, legacySource: string, legacyId: string) => `${table}:${legacySource}:${legacyId}`;

async function resolveRef(db: Queryable, idMap: IdMap, ref: Ref): Promise<string | null> {
  if (ref.kind === 'byLegacyId') {
    const cached = idMap.get(idKey(ref.table, ref.legacySource, ref.legacyId));
    if (cached) return cached;
    const result = await db.query<{ id: string }>(
      `select id from public.${ref.table} where legacy_source = $1 and legacy_id = $2 limit 1`,
      [ref.legacySource, ref.legacyId],
    );
    const id = result.rows[0]?.id ?? null;
    if (id) idMap.set(idKey(ref.table, ref.legacySource, ref.legacyId), id);
    return id;
  }
  if (ref.kind === 'byEmail') {
    const result = await db.query<{ id: string }>(`select id from public.profiles where lower(email) = lower($1) limit 1`, [ref.email]);
    return result.rows[0]?.id ?? null;
  }
  if (ref.kind === 'byRoleKey') {
    const result = await db.query<{ id: string }>(`select id from public.roles where key = $1 limit 1`, [ref.roleKey]);
    return result.rows[0]?.id ?? null;
  }
  if (ref.kind === 'byDepartmentName') {
    const result = await db.query<{ id: string }>(`select id from public.departments where name_th = $1 or name_en = $1 limit 1`, [ref.name]);
    return result.rows[0]?.id ?? null;
  }
  if (ref.kind === 'byTicketCategoryName') {
    const result = await db.query<{ id: string }>(
      `select id from public.ticket_categories where lower(name) = lower($1) limit 1`,
      [ref.name],
    );
    return result.rows[0]?.id ?? null;
  }
  if (ref.kind === 'byLineUserProfile') {
    const result = await db.query<{ linked_user_id: string }>(
      `select linked_user_id from public.line_users where line_user_id = $1 and linked_user_id is not null limit 1`,
      [ref.lineUserId],
    );
    return result.rows[0]?.linked_user_id ?? null;
  }
  const result = await db.query<{ id: string }>(`select id from public.positions where name_th = $1 or name_en = $1 limit 1`, [ref.name]);
  return result.rows[0]?.id ?? null;
}

async function runInvites(
  db: Queryable, authAdmin: AuthAdmin, invites: PendingAuthInvite[], idMap: IdMap,
): Promise<{ authInvited: number; authFailed: OperationFailure[] }> {
  let authInvited = 0;
  const authFailed: OperationFailure[] = [];
  for (const invite of invites) {
    try {
      if (!invite.email) throw new Error('missing email');
      const existing = await db.query<{ id: string }>(
        `select id from public.profiles where legacy_source = 'Users' and legacy_id = $1 limit 1`, [invite.legacyId],
      );
      let profileId = existing.rows[0]?.id;
      let invitedNow = false;
      if (!profileId) {
        const created = await authAdmin.inviteUser({ email: invite.email, fullName: invite.fullName });
        profileId = created.id;
        invitedNow = true;
      }
      await db.query(
        `update public.profiles set employee_code = coalesce($1, employee_code), full_name = $2, status = $3,
           legacy_source = 'Users', legacy_id = $4 where id = $5`,
        [invite.employeeCode, invite.fullName, invite.status, invite.legacyId, profileId],
      );
      if (invite.roleKey) {
        const role = await db.query<{ id: string }>(`select id from public.roles where key = $1 limit 1`, [invite.roleKey]);
        const roleId = role.rows[0]?.id;
        if (roleId) {
          await db.query(
            `insert into public.user_roles (user_id, role_id, legacy_source, legacy_id)
             values ($1, $2, 'Users', $3)
             on conflict (legacy_source, legacy_id) where legacy_id is not null do nothing`,
            [profileId, roleId, invite.legacyId],
          );
        } else {
          authFailed.push({ table: 'user_roles', legacySource: 'Users', legacyId: invite.legacyId, error: `role key "${invite.roleKey}" not found` });
        }
      }
      idMap.set(idKey('profiles', 'Users', invite.legacyId), profileId);
      if (invitedNow) authInvited += 1;
    } catch (error) {
      authFailed.push({ table: 'profiles', legacySource: 'Users', legacyId: invite.legacyId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { authInvited, authFailed };
}

/** Executes one already-open transaction's worth of ops; caller controls BEGIN/COMMIT/ROLLBACK. */
async function runOp(db: Queryable, idMap: IdMap, op: SqlOp): Promise<void> {
  const resolved: Record<string, string | number | boolean | null> = {};
  for (const [column, ref] of Object.entries(op.refs ?? {})) {
    const id = await resolveRef(db, idMap, ref);
    if (!id) {
      if (ref.optional) { resolved[column] = null; continue; }
      throw new Error(`could not resolve reference for column "${column}"`);
    }
    resolved[column] = id;
  }
  const usesNaturalKey = Boolean(op.naturalConflictColumns);
  const values = {
    ...op.values, ...resolved,
    ...(usesNaturalKey ? {} : { legacy_source: op.legacySource, legacy_id: op.legacyId }),
  };
  const columns = Object.keys(values);
  const conflictColumns = op.naturalConflictColumns ?? ['legacy_source', 'legacy_id'];
  // migration_readiness.sql's legacy-identity index is PARTIAL (`where legacy_id is not null`);
  // Postgres only matches an ON CONFLICT target against a partial index if the predicate is repeated here.
  const conflictClause = usesNaturalKey ? `(${conflictColumns.join(', ')})` : `(${conflictColumns.join(', ')}) where legacy_id is not null`;
  const updateSet = columns.filter((c) => !conflictColumns.includes(c)).map((c) => `${c} = excluded.${c}`);
  const returningColumn = usesNaturalKey ? conflictColumns[0]! : 'id';
  const sql = `insert into public.${op.table} (${columns.join(', ')})
    values (${columns.map((_, i) => `$${i + 1}`).join(', ')})
    on conflict ${conflictClause} do update set ${updateSet.join(', ')}
    returning ${returningColumn}`;
  const result = await db.query<Record<string, string>>(sql, Object.values(values));
  const id = result.rows[0]?.[returningColumn];
  if (id && !usesNaturalKey) idMap.set(idKey(op.table, op.legacySource, op.legacyId), id);
}

export interface ExecuteOptions {
  batchSize?: number;
}

/**
 * Executes an ImportPlan phase-by-phase, batch-by-batch. A failed row is recorded and
 * skipped; a failed *batch transaction* rolls back only that batch (runbook §"Import
 * rehearsal order" — pre-existing target data is never deleted by a failed batch).
 */
export async function executeImportPlan(
  plan: ImportPlan, db: Queryable, authAdmin: AuthAdmin, options: ExecuteOptions = {},
): Promise<ExecutionResult> {
  const batchSize = options.batchSize ?? 50;
  const idMap: IdMap = new Map();
  const { authInvited, authFailed } = await runInvites(db, authAdmin, plan.authInvites, idMap);

  let inserted = 0;
  const failed: OperationFailure[] = [];

  for (const phase of PHASE_ORDER) {
    const ops = plan.phases[phase];
    for (let i = 0; i < ops.length; i += batchSize) {
      const batch = ops.slice(i, i + batchSize);
      await db.query('BEGIN');
      let succeededInBatch = 0;
      let batchError: unknown = null;
      try {
        for (const op of batch) {
          await runOp(db, idMap, op);
          succeededInBatch += 1;
        }
        await db.query('COMMIT');
        inserted += succeededInBatch;
      } catch (error) {
        batchError = error;
        try { await db.query('ROLLBACK'); } catch { /* connection already broken; nothing more to do */ }
      }
      if (batchError) {
        // Postgres aborts the whole transaction on the first error, so every row in this
        // batch — including ones that "succeeded" via RETURNING before the failure — is
        // rolled back together. Drop any ids they wrote into the map; they no longer exist.
        const failingOp = batch[succeededInBatch];
        const message = batchError instanceof Error ? batchError.message : String(batchError);
        for (const op of batch) {
          idMap.delete(idKey(op.table, op.legacySource, op.legacyId));
          failed.push({
            table: op.table, legacySource: op.legacySource, legacyId: op.legacyId,
            error: op === failingOp ? message : `batch rolled back: ${message}`,
          });
        }
      }
    }
  }

  return { inserted, failed, authInvited, authFailed };
}
