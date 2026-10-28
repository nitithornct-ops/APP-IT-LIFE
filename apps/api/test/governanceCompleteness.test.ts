import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { governanceRoute } from '../src/routes/governance';
import type { AppEnv, Bindings } from '../src/types';

vi.mock('../src/middleware/auth', () => ({ requireAuth: async (_c: unknown, next: () => Promise<void>) => next() }));
vi.mock('../src/services/auditService', () => ({ writeAuditLog: vi.fn() }));

function appFor(rows: Record<string, unknown>[], allowed = true) {
  const app = new Hono<AppEnv>();
  const client = {
    rpc: async () => ({ data: allowed, error: null }),
    from: () => {
      let start = 0;
      let end = 0;
      const query = {
        select: () => query,
        order: () => query,
        range: (from: number, to: number) => { start = from; end = Math.min(to, from + 99); return query; },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows.slice(start, end + 1), count: rows.length, error: null }),
      };
      return query;
    },
  };
  app.use('*', async (c, next) => {
    c.set('requestId', 'governance-test');
    c.set('userId', '00000000-0000-4000-8000-000000000001');
    c.set('userEmail', 'test@example.test');
    c.set('supabase', client as never);
    await next();
  });
  app.route('/governance', governanceRoute);
  return app;
}

describe('governance completeness', () => {
  it('counts and exports older records and includes an active overdue review', async () => {
    const rows = Array.from({ length: 301 }, (_, index) => ({
      id: String(index), document_code: `DOC-${index}`, title: `Document ${index}`,
      status: 'ใช้งาน', review_date: index === 300 ? '2000-01-01' : null,
    }));
    rows[0].review_date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    rows[1].review_date = '2000-01-01';
    rows[1].status = 'ยกเลิก';
    const app = appFor(rows);
    const response = await app.request('/governance/documents', {}, {} as Bindings);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { records: Array<{ code: string }>; metrics: Array<{ value: number }> } };
    expect(body.data.records).toHaveLength(301);
    expect(body.data.records.some((record) => record.code === 'DOC-300')).toBe(true);
    expect(body.data.metrics[0].value).toBe(301);
    expect(body.data.metrics[2].value).toBe(1);

    const exported = await app.request('/governance/documents/exports/csv', { method: 'POST' }, {} as Bindings);
    expect(exported.status).toBe(200);
    expect((await exported.json() as { data: { csv: string } }).data.csv).toContain('DOC-300');
  });

  it('rejects an incomplete dataset instead of returning a partial count', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ id: String(i) }));
    const response = await appFor(rows).request('/governance/documents', {}, {} as Bindings);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'GOVERNANCE_INCOMPLETE' } });
  });

  it('continues to deny users without the domain permission', async () => {
    const response = await appFor([], false).request('/governance/documents', {}, {} as Bindings);
    expect(response.status).toBe(403);
  });
});
