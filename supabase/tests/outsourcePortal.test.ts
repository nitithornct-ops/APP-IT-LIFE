import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asServiceRole, asUser, createTestDb } from './testDb';

const USER_ID = '00000000-0000-0000-0000-000000010101';
const OTHER_USER_ID = '00000000-0000-0000-0000-000000010102';
let db: PGlite;
let vendorId: string;
let otherVendorId: string;
let accountId: string;
let ticketId: string;

beforeAll(async () => {
  db = await createTestDb();
  await asServiceRole(db, async () => {
    await db.query(`insert into auth.users(id,email) values ($1,'outsource-owner@test.local'),($2,'outsource-other@test.local')`, [USER_ID, OTHER_USER_ID]);
    await db.query(
      `insert into public.vendors(vendor_code,name,service_type,status)
       values ('VND-PORTAL-1','Portal Vendor One','Software','Active'),('VND-PORTAL-2','Portal Vendor Two','Software','Active')
       `,
    );
    const vendors = await db.query<{ id: string }>(`select id from public.vendors where vendor_code like 'VND-PORTAL-%' order by vendor_code`);
    vendorId = vendors.rows[0]!.id;
    otherVendorId = vendors.rows[1]!.id;
    const account = await db.query<{ id: string }>(
      `insert into public.vendor_portal_accounts(vendor_id,email,full_name,password_hash)
       values ($1,'contact@vendor.test','Vendor Contact','test-hash') returning id`, [vendorId],
    );
    accountId = account.rows[0]!.id;
    const ticket = await db.query<{ id: string }>(
      `insert into public.tickets(ticket_no,title,requester_id,description,status,outsource_vendor_id,outsource_name)
       values ('TCK-PORTAL-1','Outsource test',$1,'Repair detail','ส่งต่อ Outsource',$2,'Portal Vendor One') returning id`,
      [USER_ID, vendorId],
    );
    ticketId = ticket.rows[0]!.id;
  });
});

afterAll(async () => { await db.close(); });

describe('Outsource company portal database controls', () => {
  it('keeps company accounts and sessions hidden from internal authenticated users', async () => {
    const accounts = await asUser(db, USER_ID, async () => db.query('select id from public.vendor_portal_accounts'));
    const sessions = await asUser(db, USER_ID, async () => db.query('select id from public.vendor_portal_sessions'));
    expect(accounts.rows).toHaveLength(0);
    expect(sessions.rows).toHaveLength(0);
  });

  it('accepts a signed response only from the company assigned to an outsourced Ticket', async () => {
    const inserted = await asServiceRole(db, async () => db.query<{ revision: number; review_status: string }>(
      `insert into public.ticket_outsource_submissions(
         ticket_id,vendor_id,account_id,revision,response,signature_storage_path,signer_name
       ) values ($1,$2,$3,1,'{"rootCause":"bug","resolution":"fixed","testResult":"passed"}'::jsonb,'vendor/ticket/signature.png','Vendor Contact')
       returning revision,review_status`,
      [ticketId, vendorId, accountId],
    ));
    expect(inserted.rows).toEqual([{ revision: 1, review_status: 'Submitted' }]);

    await expect(asServiceRole(db, async () => db.query(
      `insert into public.ticket_outsource_submissions(
         ticket_id,vendor_id,revision,response,signature_storage_path,signer_name
       ) values ($1,$2,2,'{}'::jsonb,'other.png','Wrong Vendor')`,
      [ticketId, otherVendorId],
    ))).rejects.toThrow(/บริษัทไม่ตรง/);
  });

  it('creates a private signature bucket and publishes the vendor-signature placeholder', async () => {
    const bucket = await asServiceRole(db, async () => db.query<{ public: boolean }>(
      `select public from storage.buckets where id = 'ticket-outsource-signatures'`,
    ));
    const template = await asServiceRole(db, async () => db.query<{ included: boolean }>(
      `select content_html like '%{{vendor_signature}}%' as included
       from public.form_templates where template_code = 'IT-ERP-ISSUE'`,
    ));
    expect(bucket.rows).toEqual([{ public: false }]);
    expect(template.rows).toEqual([{ included: true }]);
  });
});
