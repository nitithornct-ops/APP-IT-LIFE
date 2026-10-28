import { expect, it, vi } from 'vitest';
import type { Bindings } from '../src/types';
import { dispatchScheduledReports } from '../src/services/reportScheduleService';

const mock = vi.hoisted(() => ({ admin: {}, generate: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => mock.admin }));
vi.mock('../src/routes/reports', () => ({
  generateScheduledSnapshot: mock.generate,
  nextScheduleAt: () => '2026-11-08T00:00:00.000Z',
}));

it('advances a completed slot on retry without generating another snapshot', async () => {
  const schedule = { id: 's1', next_run_at: '2026-11-01T00:00:00.000Z', frequency: 'weekly' };
  let run: { id: string; status: string } | null = null;
  let failScheduleUpdate = true;
  mock.generate.mockReset().mockResolvedValue({ id: 'snapshot-1', artifact: { name: null, driveId: null, driveUrl: null, error: null } });
  mock.admin = {
    from(table: string) {
      let payload: Record<string, unknown> = {};
      let action = 'select';
      const query = {
        select() { return query; },
        eq() { return query; },
        lte() { return query; },
        order() { return query; },
        limit() { return query; },
        insert(value: Record<string, unknown>) { action = 'insert'; payload = value; return query; },
        update(value: Record<string, unknown>) { action = 'update'; payload = value; return query; },
        async maybeSingle() {
          if (table === 'report_schedule_runs' && action === 'insert') {
            if (run) return { data: null, error: { code: '23505' } };
            run = { id: 'run-1', status: String(payload.status) };
            return { data: { id: run.id }, error: null };
          }
          if (table === 'report_schedule_runs' && action === 'update') {
            if (run) run.status = String(payload.status);
            return { data: run ? { id: run.id } : null, error: null };
          }
          return { data: run, error: null };
        },
        then(resolve: (value: unknown) => unknown) {
          if (table === 'report_schedules' && action === 'select') return resolve({ data: [schedule], error: null });
          if (table === 'report_schedule_runs' && action === 'update') {
            if (run) run.status = String(payload.status);
            return resolve({ error: null });
          }
          if (table === 'report_schedules' && action === 'update') {
            if (failScheduleUpdate) { failScheduleUpdate = false; return resolve({ error: { message: 'update failed' } }); }
            schedule.next_run_at = String(payload.next_run_at);
          }
          return resolve({ error: null });
        },
      };
      return query;
    },
  };
  const first = await dispatchScheduledReports({} as Bindings, new Date('2026-11-01T01:00:00Z'));
  expect(first.failed).toBe(1);
  const retry = await dispatchScheduledReports({} as Bindings, new Date('2026-11-01T01:05:00Z'));
  expect(retry.succeeded).toBe(1);
  expect(schedule.next_run_at).toBe('2026-11-08T00:00:00.000Z');
  expect(mock.generate).toHaveBeenCalledOnce();
});

it.each(['legacy', 'uploading'])('flags a stale %s claim without repeating an uncertain external upload', async (phase) => {
  mock.generate.mockReset();
  const schedule = { id: 's1', next_run_at: '2026-11-01T00:00:00.000Z', frequency: 'weekly' };
  mock.admin = {
    from(table: string) {
      let inserted = false;
      const query = {
        select() { return query; }, eq() { return query; }, lte() { return query; }, order() { return query; }, limit() { return query; },
        insert() { inserted = true; return query; },
        async maybeSingle() {
          return inserted ? { data: null, error: { code: '23505' } }
            : { data: { status: 'running', started_at: '2026-11-01T00:00:00.000Z', ...(phase === 'uploading' ? { recovery_phase: 'uploading', claim_token: 'old-token', lease_until: '2026-11-01T00:30:00.000Z' } : {}) }, error: null };
        },
        then(resolve: (value: unknown) => unknown) { return resolve({ data: table === 'report_schedules' ? [schedule] : [], error: null }); },
      };
      return query;
    },
  };
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const result = await dispatchScheduledReports({} as Bindings, new Date('2026-11-01T01:00:00Z'));
  expect(result.failed).toBe(1);
  expect(mock.generate).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('report_schedule_run_stale'));
  log.mockRestore();
});

it.each(['preparing', 'snapshot_ready'])('reclaims an expired %s lease and finalizes once', async (phase) => {
  const schedule = { id: 's1', next_run_at: '2026-11-01T00:00:00.000Z', frequency: 'weekly' };
  const run: Record<string, unknown> = { id: 'run-1', status: 'running', claim_token: 'old-token', lease_until: '2026-11-01T00:30:00Z', recovery_phase: phase, started_at: '2026-11-01T00:00:00Z' };
  mock.generate.mockReset().mockResolvedValue({ id: 'snapshot-1', artifact: { name: null, driveId: null, driveUrl: null, error: null } });
  mock.admin = {
    from(table: string) {
      let action = 'select'; let payload: Record<string, unknown> = {}; const conditions: Array<[string, unknown]> = [];
      const query = {
        select() { return query; }, eq(key: string, value: unknown) { conditions.push([key, value]); return query; },
        lte() { return query; }, order() { return query; }, limit() { return query; },
        insert(value: Record<string, unknown>) { action = 'insert'; payload = value; return query; },
        update(value: Record<string, unknown>) { action = 'update'; payload = value; return query; },
        async maybeSingle() {
          if (action === 'insert') return { data: null, error: { code: '23505' } };
          if (action === 'select') return { data: { ...run }, error: null };
          if (conditions.some(([key, value]) => run[key] !== value)) return { data: null, error: null };
          Object.assign(run, payload);
          return { data: { id: run.id }, error: null };
        },
        then(resolve: (value: unknown) => unknown) {
          if (table === 'report_schedules' && action === 'select') return resolve({ data: [schedule], error: null });
          if (table === 'report_schedules' && action === 'update') schedule.next_run_at = String(payload.next_run_at);
          return resolve({ error: null });
        },
      };
      return query;
    },
  };
  const result = await dispatchScheduledReports({} as Bindings, new Date('2026-11-01T01:00:00Z'));
  expect(result.succeeded).toBe(1);
  expect(run.status).toBe('succeeded');
  expect(run.claim_token).not.toBe('old-token');
  expect(mock.generate).toHaveBeenCalledOnce();
  expect(mock.generate.mock.calls[0][3]).toEqual({ runId: 'run-1', token: run.claim_token });
  expect(schedule.next_run_at).toBe('2026-11-08T00:00:00.000Z');
});
