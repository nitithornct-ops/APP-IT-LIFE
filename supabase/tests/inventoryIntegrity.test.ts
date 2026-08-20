import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const ACTOR_ID = '00000000-0000-0000-0000-0000000000d1';
const ITEM_ID = '00000000-0000-0000-0000-0000000000d2';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users (id, email) values ($1, 'inventory@test.local')`, [ACTOR_ID]);
    await db.query(
      `insert into public.inventory_items (id, item_name, unit, stock_qty, created_by)
       values ($1, 'Integrity test item', 'piece', 10, $2)`,
      [ITEM_ID, ACTOR_ID],
    );
  });
});

afterAll(async () => {
  await db?.close();
});

describe('atomic inventory movements', () => {
  it('updates stock, ledger and audit together', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ result: { balanceAfter: number; transaction: { transaction_type: string } } }>(
        `select public.record_inventory_transaction($1, 'OUT', 3, 'issued', $2,
          'inventory@test.local', 'req-inventory-1') as result`,
        [ITEM_ID, ACTOR_ID],
      ),
    );

    expect(Number(result.rows[0].result.balanceAfter)).toBe(7);
    expect(result.rows[0].result.transaction.transaction_type).toBe('OUT');

    const persisted = await asServiceRole(db, async () =>
      db.query<{ stock_qty: number; ledger_count: number; audit_count: number }>(
        `select i.stock_qty,
          (select count(*) from public.inventory_transactions where item_id = i.id) as ledger_count,
          (select count(*) from public.audit_logs where request_id = 'req-inventory-1') as audit_count
         from public.inventory_items i where i.id = $1`,
        [ITEM_ID],
      ),
    );
    expect(Number(persisted.rows[0].stock_qty)).toBe(7);
    expect(Number(persisted.rows[0].ledger_count)).toBe(1);
    expect(Number(persisted.rows[0].audit_count)).toBe(1);
  });

  it('rolls back every write when an OUT movement exceeds stock', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(
          `select public.record_inventory_transaction($1, 'OUT', 8, '', $2,
            'inventory@test.local', 'req-inventory-rejected')`,
          [ITEM_ID, ACTOR_ID],
        ),
      ),
    ).rejects.toThrow(/INVENTORY_INSUFFICIENT_STOCK/);

    const persisted = await asServiceRole(db, async () =>
      db.query<{ stock_qty: number; ledger_count: number; audit_count: number }>(
        `select i.stock_qty,
          (select count(*) from public.inventory_transactions where item_id = i.id) as ledger_count,
          (select count(*) from public.audit_logs where request_id = 'req-inventory-rejected') as audit_count
         from public.inventory_items i where i.id = $1`,
        [ITEM_ID],
      ),
    );
    expect(Number(persisted.rows[0].stock_qty)).toBe(7);
    expect(Number(persisted.rows[0].ledger_count)).toBe(1);
    expect(Number(persisted.rows[0].audit_count)).toBe(0);
  });

  it('records stocktake variance and audit in the same transaction', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ result: { balanceAfter: number; variance: number } }>(
        `select public.adjust_inventory_stock($1, 11, 'cycle count', $2,
          'inventory@test.local', 'req-inventory-2') as result`,
        [ITEM_ID, ACTOR_ID],
      ),
    );

    expect(Number(result.rows[0].result.balanceAfter)).toBe(11);
    expect(Number(result.rows[0].result.variance)).toBe(4);
  });

  it('does not expose service-only movement functions to browser sessions', async () => {
    await expect(
      asUser(db, ACTOR_ID, async () =>
        db.query(
          `select public.record_inventory_transaction($1, 'IN', 1, '', $2,
            'inventory@test.local', 'forged-browser-call')`,
          [ITEM_ID, ACTOR_ID],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
