import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { buildDataset, loadEntries, REPORTS, reportCsv } from '../src/routes/reports';

it('filters before pagination and includes an older department record beyond 5000 unrelated records', async () => {
  const ownerId = 'owner-1';
  const departmentId = 'dept-1';
  const tickets = Array.from({ length: 6001 }, (_, index) => ({
    id: String(index), ticket_no: `TKT-${index}`, title: 'Test ticket', status: 'open',
    priority: 'normal', created_at: '2026-01-01T00:00:00Z', assignee_id: index === 6000 ? ownerId : null,
    assignee_name_snapshot: null, rating: null,
  }));
  const tables: Record<string, Record<string, unknown>[]> = {
    tickets, employees: [], profiles: [...Array.from({ length: 6001 }, (_, index) => ({ id: `other-${index}`, full_name: 'Other', department_id: 'other' })), { id: ownerId, full_name: 'Owner', department_id: departmentId }],
  };
  const client = {
    from(table: string) {
      let start = 0;
      let end = 0;
      let countRequested = false;
      let filter: { column: string; values: unknown[] } | null = null;
      const query = {
        select(_selection: string, options?: { count?: string }) { countRequested = Boolean(options?.count); return query; },
        order() { return query; },
        range(from: number, to: number) { start = from; end = Math.min(to, from + 199); return query; },
        in(column: string, values: unknown[]) { filter = { column, values }; return query; },
        eq(column: string, value: unknown) { filter = { column, values: [value] }; return query; },
        limit() { return query; },
        then(resolve: (result: unknown) => unknown) {
          const sourceRows = tables[table] ?? [];
          const rows = filter ? sourceRows.filter((row) => filter!.values.includes(row[filter!.column])) : sourceRows;
          return resolve({ data: countRequested ? rows.slice(start, end + 1) : [], count: countRequested ? rows.length : null, error: null });
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const config = REPORTS['service-desk'];
  const loaded = await loadEntries(client, new Set(['ticket.view']), config, { rangeDays: 0, departmentId });
  expect(loaded.error).toBeUndefined();
  const dataset = buildDataset(config, config, loaded.entries, 0);
  expect(dataset.totalRows).toBe(1);
  expect(dataset.rows[0].code).toBe('TKT-6000');
  expect(dataset.rows[0].owner).toBe('Owner');
  expect(reportCsv(dataset)).toContain('TKT-6000');
  tables.tickets = [tickets[6000]];
  const unfiltered = await loadEntries(client, new Set(['ticket.view']), config, { rangeDays: 0 });
  expect(unfiltered.error).toBeUndefined();
  expect(buildDataset(config, config, unfiltered.entries, 0).rows[0].owner).toBe('Owner');
  tables.asset_verifications = [{ id: 'verification', result: 'wrong_custodian', scanned_at: '2026-01-01T00:00:00Z', actual_custodian_employee_id: ownerId, expected_custodian_employee_id: 'other-0' }];
  const verification = REPORTS['asset-verification'];
  const selected = await loadEntries(client, new Set(['asset.view']), verification, { rangeDays: 0, departmentId });
  expect(selected.error).toBeUndefined();
  expect(buildDataset(verification, verification, selected.entries, 0).rows[0]).toMatchObject({ actualCustodian: 'Owner', expectedCustodian: 'Other' });
});
