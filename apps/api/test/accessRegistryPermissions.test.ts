import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import type { AppEnv, Bindings } from '../src/types';
import { accessRegistryRoute } from '../src/routes/accessRequests';

const mock = vi.hoisted(() => ({ client: {} }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => mock.client }));
vi.mock('../src/middleware/auth', () => ({ requireAuth: async (_c: unknown, next: () => Promise<void>) => next() }));
vi.mock('../src/services/auditService', () => ({ writeAuditLog: vi.fn() }));

function harness(permissions: string[]) {
  const calls: string[] = [];
  const client = {
    rpc: async (_name: string, args: { permission_key_input: string }) => ({ data: permissions.includes(args.permission_key_input), error: null }),
    from(table: string) {
      const query = {
        select() { return query; }, order() { return query; }, limit() { return query; }, in() { return query; },
        or(value: string) { calls.push(value); return query; },
        then(resolve: (value: unknown) => unknown) {
          const data = table === 'user_access_registry' ? [{ id: 'registry', access_item_id: 'item-1', access_control_item: null }]
            : table === 'access_control_items' ? [{ id: 'item-1', kind: 'role', code: 'role-code', name: 'Role name' }]
              : [{ id: 'target', full_name: 'User 101', email: 'user101@test.local' }];
          return resolve({ data, error: null });
        },
      };
      return query;
    },
  };
  mock.client = client;
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'registry-test'); c.set('userId', 'actor'); c.set('userEmail', 'test@example.test'); c.set('supabase', client as never); await next();
  });
  app.route('/registry', accessRegistryRoute);
  return { app, calls };
}

it.each(['access_registry.manage', 'access_registry.review', 'audit.view'])('allows the registry list to %s', async (permission) => {
  const response = await harness([permission]).app.request('/registry', {}, {} as Bindings);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: [expect.objectContaining({ access_control_item: { name: 'Role name', code: 'role-code', kind: 'role' } })] });
});

it('restricts account lookup to managers and searches beyond the initial user page', async () => {
  const denied = await harness(['audit.view']).app.request('/registry/deactivation-candidates?search=user101', {}, {} as Bindings);
  expect(denied.status).toBe(403);
  const { app, calls } = harness(['access_registry.manage']);
  const response = await app.request('/registry/deactivation-candidates?search=user101', {}, {} as Bindings);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: [{ id: 'target' }] });
  expect(calls[0]).toContain('user101');
});
