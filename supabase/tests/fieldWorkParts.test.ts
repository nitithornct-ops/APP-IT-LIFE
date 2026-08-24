import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, createTestDb } from './testDb';

/**
 * 20260917100000_field_work_parts_provenance.sql
 *
 * การเบิกอะไหล่จากหน้างานต้องตรวจย้อนได้ว่าของหายไปจากคลังเพราะงานใบไหน เทสต์ชุดนี้ยึดสองอย่าง:
 * ยอดคงเหลือกับ ledger ยังถูกต้องเหมือนเดิม และแถวใน ledger ผูกกับ Ticket จริงเสมอเมื่อระบุมา
 * รวมถึงยึดว่าฟังก์ชันรุ่นเก่าที่ไม่ผูก Ticket ถูกถอดออกแล้ว จะได้ไม่มีทางเบิกที่ข้ามการผูกไปเงียบ ๆ
 */

const ACTOR_ID = '00000000-0000-0000-0000-0000000000e1';
const ITEM_ID = '00000000-0000-0000-0000-0000000000e2';
const MISSING_TICKET_ID = '00000000-0000-0000-0000-0000000000ef';

let db: PGlite;
let ticketId: string;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users (id, email) values ($1, 'field@test.local')`, [ACTOR_ID]);
    await db.query(
      `insert into public.inventory_items (id, item_name, unit, stock_qty, created_by)
       values ($1, 'สาย HDMI', 'เส้น', 10, $2)`,
      [ITEM_ID, ACTOR_ID],
    );
    const ticket = await db.query<{ id: string }>(
      `insert into public.tickets (title, requester_id, description)
       values ('จอไม่แสดงภาพ', $1, 'ต้องเปลี่ยนสายสัญญาณ') returning id`,
      [ACTOR_ID],
    );
    ticketId = ticket.rows[0].id;
  });
});

afterAll(async () => {
  await db?.close();
});

describe('parts consumed at the customer site', () => {
  it('links the stock movement to the ticket it was used on', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ result: { balanceAfter: number; transaction: { ticket_id: string; transaction_type: string } } }>(
        `select public.record_inventory_transaction($1, 'OUT', 2, 'เปลี่ยนสายหน้างาน', $2,
          'field@test.local', 'req-field-1', $3) as result`,
        [ITEM_ID, ACTOR_ID, ticketId],
      ),
    );

    expect(Number(result.rows[0].result.balanceAfter)).toBe(8);
    expect(result.rows[0].result.transaction.ticket_id).toBe(ticketId);
    expect(result.rows[0].result.transaction.transaction_type).toBe('OUT');
  });

  it('records the ticket in the audit trail as well as the ledger', async () => {
    const audit = await asServiceRole(db, async () =>
      db.query<{ detail: { ticketId: string } }>(
        `select detail from public.audit_logs where request_id = 'req-field-1'`,
      ),
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].detail.ticketId).toBe(ticketId);
  });

  it('still allows an ordinary stock movement with no ticket attached', async () => {
    const result = await asServiceRole(db, async () =>
      db.query<{ result: { transaction: { ticket_id: string | null } } }>(
        `select public.record_inventory_transaction($1, 'IN', 5, 'รับเข้าคลัง', $2,
          'field@test.local', 'req-field-2') as result`,
        [ITEM_ID, ACTOR_ID],
      ),
    );
    expect(result.rows[0].result.transaction.ticket_id).toBeNull();
  });

  it('refuses a movement pointing at a ticket that does not exist, without touching stock', async () => {
    await expect(
      asServiceRole(db, async () =>
        db.query(
          `select public.record_inventory_transaction($1, 'OUT', 1, '', $2,
            'field@test.local', 'req-field-missing', $3)`,
          [ITEM_ID, ACTOR_ID, MISSING_TICKET_ID],
        ),
      ),
    ).rejects.toThrow(/INVENTORY_TICKET_NOT_FOUND/);

    const persisted = await asServiceRole(db, async () =>
      db.query<{ stock_qty: number; audit_count: number }>(
        `select i.stock_qty,
          (select count(*) from public.audit_logs where request_id = 'req-field-missing') as audit_count
         from public.inventory_items i where i.id = $1`,
        [ITEM_ID],
      ),
    );
    expect(Number(persisted.rows[0].stock_qty)).toBe(13);
    expect(Number(persisted.rows[0].audit_count)).toBe(0);
  });

  it('keeps the stock ledger when the ticket is deleted, so past balances stay explainable', async () => {
    await asServiceRole(db, async () => {
      const ledgerBefore = await db.query<{ count: number }>(
        `select count(*)::int as count from public.inventory_transactions where ticket_id = $1`,
        [ticketId],
      );
      expect(ledgerBefore.rows[0].count).toBe(1);

      await db.query('delete from public.tickets where id = $1', [ticketId]);

      const ledgerAfter = await db.query<{ count: number; ticket_id: string | null }>(
        `select count(*)::int as count, min(ticket_id::text) as ticket_id
         from public.inventory_transactions where transaction_type = 'OUT'`,
      );
      expect(ledgerAfter.rows[0].count).toBe(1);
      expect(ledgerAfter.rows[0].ticket_id).toBeNull();
    });
  });

  it('no longer exposes the old seven-argument function that skipped the ticket link', async () => {
    const overloads = await asServiceRole(db, async () =>
      db.query<{ count: number }>(
        `select count(*)::int as count
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'record_inventory_transaction'`,
      ),
    );
    expect(overloads.rows[0].count).toBe(1);
  });
});
