import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv, Bindings } from '../src/types';
import { ticketsRoute } from '../src/routes/tickets';
import { assetsRoute } from '../src/routes/assets';

vi.mock('../src/middleware/auth', () => ({ requireAuth: async (_c: unknown, next: () => Promise<void>) => next() }));
vi.mock('../src/services/auditService', () => ({ writeAuditLog: vi.fn(), loadAuditSnapshot: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: vi.fn(() => ({})), embeddedName: vi.fn() }));

const id = '00000000-0000-4000-8000-000000000001';

function harness(route: 'tickets' | 'assets', allowed = true, rows: Record<string, unknown>[] = []) {
  const calls: Array<[string, unknown]> = [];
  let start = 0;
  let end = 0;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => { calls.push([column, value]); return query; }),
    or: vi.fn((value: string) => { calls.push(['or', value]); return query; }),
    order: vi.fn(() => query),
    range: vi.fn((from: number, to: number) => { start = from; end = Math.min(to, from + 99); return query; }),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows.slice(start, end + 1), count: rows.length, error: allowed ? null : { message: 'denied' } }),
  };
  const client = { from: vi.fn(() => query), rpc: vi.fn(async () => ({ data: allowed, error: null })) };
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'export-test');
    c.set('userId', id);
    c.set('userEmail', 'test@example.test');
    c.set('supabase', client as never);
    await next();
  });
  app.route(`/${route}`, route === 'tickets' ? ticketsRoute : assetsRoute);
  return { app, calls };
}

describe.each(['tickets', 'assets'] as const)('%s export routing', (route) => {
  it('reaches the export handler and applies the requested filter', async () => {
    const { app, calls } = harness(route);
    const response = await app.request(`/${route}/export?search=needle`, {}, {} as Bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { rowCount: 0 } });
    expect(calls.filter(([column, value]) => column === 'or' && String(value).includes('needle'))).toHaveLength(2);
    expect(calls).not.toContainEqual(['id', 'export']);
  });

  it('keeps UUID detail requests on the detail handler', async () => {
    const { app, calls } = harness(route);
    const response = await app.request(`/${route}/${id}`, {}, {} as Bindings);
    expect(response.status).toBe(404);
    expect(calls).toContainEqual(['id', id]);
  });

  it('exports all rows when the database imposes a smaller page size', async () => {
    const rows = Array.from({ length: 1201 }, (_, i) => ({ id: String(i), ticket_no: `TKT-${i}`, asset_code: `AST-${i}`, title: 'Test', name: 'Test' }));
    const { app } = harness(route, true, rows);
    const response = await app.request(`/${route}/export`, {}, {} as Bindings);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { rowCount: number; csv: string } };
    expect(body.data.rowCount).toBe(1201);
    expect(body.data.csv).toContain(route === 'tickets' ? 'TKT-1200' : 'AST-1200');
  });
});

it('rejects asset export without asset.view permission', async () => {
  const { app } = harness('assets', false);
  const response = await app.request('/assets/export', {}, {} as Bindings);
  expect(response.status).toBe(403);
});

it('fails closed when the ticket data source rejects the export', async () => {
  const { app } = harness('tickets', false);
  const response = await app.request('/tickets/export', {}, {} as Bindings);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ success: false, error: { code: 'TICKETS_EXPORT_FAILED' } });
});
