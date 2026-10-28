import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import type { AppEnv, Bindings } from '../src/types';
import { workflowsRoute } from '../src/routes/workflows';

const mock = vi.hoisted(() => ({ admin: {} }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => mock.admin }));
vi.mock('../src/middleware/auth', () => ({ requireAuth: async (_c: unknown, next: () => Promise<void>) => next() }));
vi.mock('../src/services/auditService', () => ({ writeAuditLog: vi.fn(), loadAuditSnapshot: vi.fn() }));

it('finds a pending approval beyond the old global approval and instance limits', async () => {
  const actor = 'user-1';
  const instances = Array.from({ length: 501 }, (_, i) => ({
    id: `instance-${i}`, requester_id: 'requester', definition_id: 'definition', status: 'กำลังดำเนินการ', archived_at: null,
  }));
  const approvals = Array.from({ length: 2001 }, (_, i) => ({
    id: `old-${i}`, instance_id: 'old-instance', approver_id: 'other', original_approver_id: 'other', status: 'อนุมัติ',
  }));
  approvals.push({ id: 'new', instance_id: 'instance-500', approver_id: actor, original_approver_id: actor, status: 'รอพิจารณา' });
  const tables: Record<string, Record<string, unknown>[]> = {
    workflow_instances: instances, workflow_approvals: approvals, workflow_history: [], workflow_definitions: [],
    workflow_steps: [], workflow_delegations: [], profiles: [],
  };
  function from(table: string, userScoped = false) {
      let rows = [...(tables[table] ?? [])];
      if (userScoped && table === 'workflow_instances') rows = rows.filter((row) => row.id === 'instance-500');
      if (userScoped && (table === 'workflow_approvals' || table === 'workflow_history')) rows = rows.filter((row) => row.instance_id === 'instance-500');
      let start = 0;
      let end = Number.MAX_SAFE_INTEGER;
      let withCount = false;
      const query = {
        select(_fields: string, options?: { count?: string }) { withCount = Boolean(options?.count); return query; },
        eq(column: string, value: unknown) { rows = rows.filter((row) => row[column] === value); return query; },
        is(column: string, value: unknown) { rows = rows.filter((row) => (row[column] ?? null) === value); return query; },
        in(column: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[column])); return query; },
        order() { return query; },
        limit(size: number) { end = size - 1; return query; },
        range(from: number, to: number) { start = from; end = Math.min(to, from + 99); return query; },
        then(resolve: (value: unknown) => unknown) { return resolve({ data: rows.slice(start, end + 1), count: withCount ? rows.length : null, error: null }); },
      };
      return query;
  }
  mock.admin = { from };
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'workflow-test');
    c.set('userId', actor);
    c.set('userEmail', 'test@example.test');
    c.set('supabase', { from: (table: string) => from(table, true), rpc: async (_name: string, args: { permission_key_input: string }) => ({
      data: ['workflow.view', 'workflow.approve'].includes(args.permission_key_input), error: null,
    }) } as never);
    await next();
  });
  app.route('/workflows', workflowsRoute);
  const response = await app.request('/workflows', {}, {} as Bindings);
  expect(response.status).toBe(200);
  const body = await response.json() as { data: { summary: { pendingMine: number; activeVisible: number; activeMine: number }; myApprovals: Array<{ id: string; can_act: boolean }>; instances: Array<{ id: string }> } };
  expect(body.data.summary.pendingMine).toBe(1);
  expect(body.data.summary.activeVisible).toBe(1);
  expect(body.data.summary.activeMine).toBe(0);
  expect(body.data.myApprovals).toEqual([expect.objectContaining({ id: 'new', can_act: true })]);
  expect(body.data.instances).toEqual([expect.objectContaining({ id: 'instance-500' })]);
  const page = await app.request('/workflows/instances/page?page=1', {}, {} as Bindings);
  expect(page.status).toBe(200);
  const pageBody = await page.json() as { data: { total: number; instances: Array<{ id: string }> } };
  expect(pageBody.data.total).toBe(1);
  expect(pageBody.data.instances.map((item) => item.id)).toEqual(['instance-500']);
  expect((await app.request('/workflows/instances/page?page=0', {}, {} as Bindings)).status).toBe(400);
});

it('pages older visible instances and counts only the caller-visible rows', async () => {
  const actor = 'user-1';
  const visible = Array.from({ length: 526 }, (_, i) => ({ id: `visible-${i}`, requester_id: actor, definition_id: 'd', status: 'กำลังดำเนินการ', archived_at: null }));
  const hidden = { id: 'hidden', requester_id: 'other', definition_id: 'd', status: 'กำลังดำเนินการ', archived_at: null };
  const tables: Record<string, Record<string, unknown>[]> = { workflow_instances: [...visible, hidden], workflow_approvals: [], workflow_history: [], profiles: [], workflow_definitions: [] };
  const makeQuery = (table: string, scoped: boolean) => {
    let rows = [...(tables[table] ?? [])]; let start = 0; let end = Number.MAX_SAFE_INTEGER;
    if (scoped && table === 'workflow_instances') rows = rows.filter((row) => row.requester_id === actor);
    const q = {
      select() { return q; }, is(key: string, value: unknown) { rows = rows.filter((row) => (row[key] ?? null) === value); return q; },
      eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return q; },
      in(key: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[key])); return q; },
      order() { return q; }, range(from: number, to: number) { start = from; end = to; return q; },
      then(resolve: (value: unknown) => unknown) { return resolve({ data: rows.slice(start, end + 1), count: rows.length, error: null }); },
    };
    return q;
  };
  mock.admin = { from: (table: string) => makeQuery(table, false) };
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'workflow-page'); c.set('userId', actor); c.set('userEmail', 'test@example.test');
    c.set('supabase', { from: (table: string) => makeQuery(table, true), rpc: async () => ({ data: true, error: null }) } as never);
    await next();
  });
  app.route('/workflows', workflowsRoute);
  const response = await app.request('/workflows/instances/page?page=22', {}, {} as Bindings);
  expect(response.status).toBe(200);
  const body = await response.json() as { data: { total: number; pageSize: number; instances: Array<{ id: string }> } };
  expect(body.data.total).toBe(526);
  expect(body.data.pageSize).toBe(25);
  expect(body.data.instances.map((item) => item.id)).toEqual(['visible-525']);
});
