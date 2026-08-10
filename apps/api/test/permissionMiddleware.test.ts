import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { requireAnyPermission } from '../src/middleware/permission';
import type { AppEnv, Bindings } from '../src/types';

vi.mock('../src/services/auditService', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));

describe('requireAnyPermission', () => {
  it('returns the fail-closed 403 response when none of the permissions are granted', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('requestId', 'permission-test');
      c.set('userId', '00000000-0000-0000-0000-000000000001');
      c.set('userEmail', 'user@test.local');
      c.set('supabase', { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) } as never);
      await next();
    });
    app.get('/protected', requireAnyPermission(['backup.view', 'monitoring.view']), (c) => c.json({ success: true }));

    const response = await app.request('/protected', {}, {} as Bindings);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
  });
});
