import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import type { AppEnv, Bindings } from '../src/types';
import { assetsRoute } from '../src/routes/assets';

const mocks = vi.hoisted(() => ({ client: {} }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => mocks.client, embeddedName: vi.fn() }));
vi.mock('../src/middleware/auth', () => ({ requireAuth: async (_c: unknown, next: () => Promise<void>) => next() }));
vi.mock('../src/services/auditService', () => ({ writeAuditLog: vi.fn(), loadAuditSnapshot: vi.fn() }));

it('shows assigned device allocations and removes them after reclaim', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  let state = 'assigned';
  let legacy = false;
  const filters: Array<[string, string]> = [];
  const license = { id: 'license-1', software_name: 'Software', license_type: 'device', status: 'active' };
  const client = {
    rpc: async () => ({ data: true, error: null }),
    from(table: string) {
      let status = '';
      const query = {
        select() { return query; },
        eq(column: string, value: string) { if (table === 'software_license_allocations') filters.push([column, value]); if (column === 'status') status = value; return query; },
        ilike() { return query; },
        order() { return query; }, limit() { return query; },
        async maybeSingle() { return { data: table === 'assets' ? { id, price: null, purchase_date: null, useful_life_years: null, warranty_expire: null, license_expiry: null } : null, error: null }; },
        then(resolve: (value: unknown) => unknown) { return resolve({ data: table === 'software_license_allocations' && state === status ? [{ license }] : table === 'software_licenses' && legacy ? [license] : [], error: null }); },
      };
      return query;
    },
  };
  mocks.client = client;
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'asset-test'); c.set('userId', id); c.set('userEmail', 'test@example.test'); c.set('supabase', client as never);
    await next();
  });
  app.route('/assets', assetsRoute);
  let response = await app.request(`/assets/${id}`, {}, {} as Bindings);
  expect(await response.json()).toMatchObject({ data: { licenses: [license] } });
  state = 'reclaimed';
  response = await app.request(`/assets/${id}`, {}, {} as Bindings);
  expect(await response.json()).toMatchObject({ data: { licenses: [] } });
  legacy = true;
  response = await app.request(`/assets/${id}`, {}, {} as Bindings);
  expect(await response.json()).toMatchObject({ data: { licenses: [], legacyLicenseCandidates: [license] } });
  expect(filters).toContainEqual(['asset_id', id]);
  expect(filters).toContainEqual(['status', 'assigned']);
});
