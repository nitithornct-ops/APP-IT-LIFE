import { Hono } from 'hono';
import { beforeEach, expect, it, vi } from 'vitest';
import { usersRoute } from '../src/routes/users';
import type { AppEnv, Bindings } from '../src/types';

const targetId = '00000000-0000-4000-8000-000000000002';
const mock = vi.hoisted(() => ({
  rpc: vi.fn(), deleteUser: vi.fn(), snapshot: vi.fn(), audit: vi.fn(), allowed: true,
}));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => ({ rpc: mock.rpc, auth: { admin: { deleteUser: mock.deleteUser } } }) }));
vi.mock('../src/services/auditService', () => ({ loadAuditSnapshot: mock.snapshot, writeAuditLog: mock.audit }));
vi.mock('../src/middleware/auth', () => ({ requireAuth: async (_c: unknown, next: () => Promise<void>) => next() }));

beforeEach(() => {
  vi.resetAllMocks(); mock.allowed = true;
  mock.snapshot.mockResolvedValue({ id: targetId, status: 'inactive' });
  mock.deleteUser.mockResolvedValue({ error: null });
});

function request(method: string, body?: unknown, self = false) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'deletion-test');
    c.set('userId', self ? targetId : '00000000-0000-4000-8000-000000000001');
    c.set('supabase', { rpc: async () => ({ data: mock.allowed, error: null }) } as never);
    await next();
  });
  app.route('/users', usersRoute);
  return app.request(`/users/${targetId}${method === 'GET' ? '/deletion-preview' : ''}`, {
    method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }, {} as Bindings);
}

it('returns dependency counts without deleting anything', async () => {
  mock.rpc.mockResolvedValue({ error: { message: 'USER_HAS_DEPENDENCIES:[{"table":"tickets","column":"requester_id","count":3}]' } });
  const response = await request('GET');
  expect(await response.json()).toMatchObject({ success: true, data: { hasDependencies: true, dependencies: [{ table: 'tickets', count: 3 }] } });
  expect(mock.deleteUser).not.toHaveBeenCalled();
});

it('soft-deletes only with explicit preserve-history consent and audits the mode', async () => {
  mock.rpc.mockResolvedValue({ error: { message: 'USER_HAS_DEPENDENCIES:[]' } });
  const response = await request('DELETE', { reason: 'พนักงานลาออก', mode: 'preserve-history' });
  expect(response.status).toBe(200);
  expect(mock.deleteUser).toHaveBeenCalledWith(targetId, true);
  expect(mock.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ detail: { reason: 'พนักงานลาออก', mode: 'preserve-history' } }));
});

it.each(['USER_HAS_DEPENDENCIES:[]', 'USER_MUST_BE_INACTIVE', 'LAST_SUPER_ADMIN'])('keeps the hard-delete guard for %s', async (message) => {
  mock.rpc.mockResolvedValue({ error: { message } });
  expect((await request('DELETE', { reason: 'ทดสอบการลบ' })).status).toBe(409);
  expect(mock.deleteUser).not.toHaveBeenCalled();
});

it.each(['USER_MUST_BE_INACTIVE', 'LAST_SUPER_ADMIN', 'database unavailable'])('does not bypass safety errors for preserve-history: %s', async (message) => {
  mock.rpc.mockResolvedValue({ error: { message } });
  const response = await request('DELETE', { reason: 'ทดสอบการลบ', mode: 'preserve-history' });
  expect(response.status).not.toBe(200);
  expect(mock.deleteUser).not.toHaveBeenCalled();
});

it('requires user.manage permission and prevents self deletion', async () => {
  mock.allowed = false;
  expect((await request('DELETE', { reason: 'ทดสอบการลบ', mode: 'preserve-history' })).status).toBe(403);
  mock.allowed = true;
  expect((await request('DELETE', { reason: 'ทดสอบการลบ', mode: 'preserve-history' }, true)).status).toBe(409);
  expect(mock.deleteUser).not.toHaveBeenCalled();
});

it('does not audit success when Auth deletion fails', async () => {
  mock.rpc.mockResolvedValue({ error: null });
  mock.deleteUser.mockResolvedValue({ error: { message: 'Auth unavailable' } });
  expect((await request('DELETE', { reason: 'ทดสอบการลบ', mode: 'preserve-history' })).status).not.toBe(200);
  expect(mock.audit).not.toHaveBeenCalled();
});

it('keeps hard deletion available when the account has no dependencies', async () => {
  mock.rpc.mockResolvedValue({ error: null });
  expect((await request('DELETE', { reason: 'บัญชีทดสอบ' })).status).toBe(200);
  expect(mock.deleteUser).toHaveBeenCalledWith(targetId, false);
});
