import { expect, it, vi } from 'vitest';
import { generateScheduledSnapshot } from '../src/routes/reports';
import type { Bindings } from '../src/types';

const mock = vi.hoisted(() => ({ admin: {}, upload: vi.fn(), gate: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => mock.admin }));
vi.mock('../src/services/googleDriveService', () => ({ uploadCsvAsGoogleSheet: mock.upload, uploadToDrive: vi.fn(), safeDriveName: (name: string) => name, buddhistYearFolder: () => '2569', googleDriveConfig: vi.fn() }));

function savedSnapshotAdmin() {
  return {
    from(table: string) {
      const q = { select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: { snapshot_id: 'snapshot-1' }, error: null }),
        single: async () => ({ data: table === 'report_snapshots' ? { id: 'snapshot-1', title: 'Saved title', dataset: { old: true } } : null, error: null }),
      };
      return q;
    },
    rpc: mock.gate,
  };
}

it('reuses the previously saved dataset after a reclaimed run', async () => {
  mock.admin = savedSnapshotAdmin();
  const result = await generateScheduledSnapshot({} as Bindings, { report_key: 'service-desk', format: 'PRINT' }, new Date('2026-11-01T00:00:00Z'), { runId: 'run-1', token: 'new-token' });
  expect(result).toEqual({ id: 'snapshot-1', title: 'Saved title', artifact: { name: null, driveId: null, driveUrl: null, error: null } });
});

it('does not start an upload if its durable claim cannot be confirmed', async () => {
  mock.upload.mockReset(); mock.gate.mockReset().mockResolvedValue({ data: false, error: null });
  mock.admin = savedSnapshotAdmin();
  await expect(generateScheduledSnapshot({} as Bindings, { report_key: 'service-desk', format: 'CSV', save_to_drive: true }, new Date(), { runId: 'run-1', token: 'old-token' }))
    .rejects.toMatchObject({ name: 'ScheduledReportClaimUncertainError' });
  expect(mock.upload).not.toHaveBeenCalled();
});
