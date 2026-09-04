import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './testDb';

let db: PGlite;

beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db.close(); });

describe('privileged function ACL hardening', () => {
  it('removes schema CREATE from public API roles', async () => {
    const result = await db.query<{ anon_create: boolean; authenticated_create: boolean }>(`
      select
        has_schema_privilege('anon', 'public', 'create') as anon_create,
        has_schema_privilege('authenticated', 'public', 'create') as authenticated_create
    `);
    expect(result.rows).toEqual([{ anon_create: false, authenticated_create: false }]);
  });

  it('does not expose SECURITY DEFINER or trigger entrypoints to anon', async () => {
    const result = await db.query<{ signature: string }>(`
      select p.oid::regprocedure::text as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any(array[
          'can_view_workflow_instance', 'current_department_id', 'has_permission', 'has_role',
          'mark_knowledge_article_helpful', 'my_permissions', 'my_roles',
          'capture_ticket_privacy_consent', 'enforce_change_workflow', 'enforce_incident_closure_gate',
          'guard_helpdesk_ticket', 'guard_ticket_outsource_submission', 'guard_ticket_worklog_actor',
          'handle_new_user', 'prevent_last_super_admin_removal',
          'register_vendor_portal_login_failure', 'register_vendor_portal_login_success'
        ])
        and has_function_privilege('anon', p.oid, 'execute')
    `);
    expect(result.rows).toEqual([]);
  });
});
