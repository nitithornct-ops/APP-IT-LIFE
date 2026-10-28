import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import type { AppEnv, Bindings } from '../src/types';
import { knowledgeRoute, publicKnowledgeRoute } from '../src/routes/knowledge';

const mock = vi.hoisted(() => ({ client: {} }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => mock.client }));
vi.mock('../src/middleware/auth', () => ({ requireAuth: async (_c: unknown, next: () => Promise<void>) => next() }));
vi.mock('../src/middleware/rateLimit', () => ({
  clientIp: () => 'test',
  edgeRateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock('../src/services/auditService', () => ({ writeAuditLog: vi.fn(), loadAuditSnapshot: vi.fn() }));

it.each([false, true])('searches before limiting and preserves the public filter: public=%s', async (publicOnly) => {
  const calls: Array<[string, unknown]> = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => name === 'has_permission'
      ? { data: true, error: null }
      : (calls.push(['search', args]), { data: [{ id: 'old-article' }], error: null })),
    from(table: string) {
      const query = {
        select() { return query; }, order() { return query; },
        in(column: string, value: unknown) { calls.push([column, value]); return query; },
        eq(column: string, value: unknown) { calls.push([column, value]); return query; },
        or(value: string) { calls.push(['or', value]); return query; },
        then(resolve: (value: unknown) => unknown) {
          return resolve({ data: table === 'knowledge_articles' ? [{ id: 'old-article', title: 'Specific article', taxonomy: null }] : [], error: null });
        },
      };
      return query;
    },
  };
  mock.client = client;
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'knowledge-test'); c.set('userId', 'user-1'); c.set('userEmail', 'test@example.test');
    c.set('supabase', client as never);
    await next();
  });
  app.route('/knowledge', publicOnly ? publicKnowledgeRoute : knowledgeRoute);
  const response = await app.request('/knowledge?search=Specific', {}, {} as Bindings);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, data: { articles: [expect.objectContaining({ id: 'old-article' })] } });
  expect(calls).toContainEqual(['search', expect.objectContaining({ search_input: 'Specific', public_only_input: publicOnly, limit_input: publicOnly ? 31 : 501 })]);
  if (publicOnly) expect(calls).toContainEqual(['is_deprecated', false]);
});
