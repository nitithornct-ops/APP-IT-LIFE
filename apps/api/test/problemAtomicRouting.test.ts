import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import type { AppEnv, Bindings } from '../src/types';
import { problemsRoute } from '../src/routes/problems';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('../src/middleware/auth', () => ({ requireAuth: async (_c: unknown, next: () => Promise<void>) => next() }));
vi.mock('../src/services/auditService', () => ({ writeAuditLog: vi.fn(), loadAuditSnapshot: vi.fn() }));

it('passes the validated update and links to the atomic database operation', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const ci = '00000000-0000-4000-8000-000000000002';
  mocks.rpc.mockReset().mockResolvedValue({ data: { id }, error: null });
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { id, title: 'Updated' }, error: null }) };
  mocks.from.mockReset().mockReturnValue(query);
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'problem-test'); c.set('userId', id); c.set('userEmail', 'test@example.test');
    c.set('supabase', { rpc: async () => ({ data: true, error: null }) } as never);
    await next();
  });
  app.route('/problems', problemsRoute);
  const response = await app.request(`/problems/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Updated', configurationItemIds: [ci] }),
  }, {} as Bindings);
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith('update_problem_atomic', expect.objectContaining({
    problem_id_input: id, patch_input: { title: 'Updated' }, ci_ids_input: [ci], change_ids_input: null,
  }));
  expect(await response.json()).toMatchObject({ success: true, data: { title: 'Updated' } });
});
