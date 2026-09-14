import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, createTestDb } from './testDb';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => db.close());

describe('CMDB P0/P1 extensions', () => {
  it('applies governance metadata, new CI types and automatic data quality scoring', async () => {
    const columns = await asServiceRole(db, () => db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'configuration_items'`,
    ));

    expect(columns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      'application_service',
      'source_of_truth',
      'discovery_source',
      'lifecycle',
      'data_quality_score',
      'auto_reconciliation',
      'ci_owner_review_status',
      'ci_owner_review_at',
      'ci_owner_review_by',
    ]));

    const inserted = await asServiceRole(db, () => db.query<{ ci_type: string; data_quality_score: number }>(
      `insert into public.configuration_items (
         ci_code, name, ci_type, environment, business_service,
         application_service, source_of_truth, discovery_source
       ) values ('CI-P0P1-001', 'CMDB test application service', 'Application Service', 'Production',
         'Customer Portal', 'Customer Portal API', 'CMDB', 'Discovery Scanner')
       returning ci_type, data_quality_score`,
    ));

    expect(inserted.rows[0]).toEqual({ ci_type: 'Application Service', data_quality_score: 55 });

    const network = await asServiceRole(db, () => db.query<{ ci_type: string }>(
      `insert into public.configuration_items (ci_code, name, ci_type, environment)
       values ('CI-P0P1-002', 'CMDB test network', 'Network', 'Production')
       returning ci_type`,
    ));

    expect(network.rows[0].ci_type).toBe('Network');

    const changeColumns = await asServiceRole(db, () => db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'change_requests'
         and column_name = 'configuration_item_id'`,
    ));

    expect(changeColumns.rows).toHaveLength(1);
  });
});
