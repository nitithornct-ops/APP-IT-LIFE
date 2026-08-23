-- ============================================================================
-- Mobile Field Workflow — ผูกการตัดสต็อกอะไหล่เข้ากับ Ticket ที่ใช้อะไหล่นั้นจริง
--
-- design_handoff_it_service_redesign/02-screens.md หัวข้อ "3j มือถือหน้างาน" ให้ช่างเลือก
-- "อะไหล่ที่ใช้ (ตัดสต็อกอัตโนมัติ)" ตอนปิดงานหน้างาน แต่ inventory_transactions เดิมเก็บได้แค่
-- item_id / qty / notes ไม่มีที่บอกว่าอะไหล่ชิ้นนั้นถูกเบิกไปใช้กับงานใบไหน
--
-- ถ้าปล่อยไว้ การเบิกจากหน้างานจะกลายเป็นยอดที่หายไปจากคลังโดยไม่มีที่มา ตรวจย้อนไม่ได้ว่าใครเบิก
-- ไปใช้กับเครื่องไหน และกระทบทั้งการคิดต้นทุนงานซ่อมและการตรวจสอบภายใน การใส่เลข Ticket ลงช่อง
-- notes ซึ่งเป็นข้อความอิสระไม่นับว่าเป็น provenance เพราะ query ไม่ได้และถูก redact ตอนทำ audit
--
-- ticket_id เป็น nullable เพราะการเบิก/รับเข้าคลังตามปกติ (ไม่ได้ผูกกับงานซ่อม) ยังต้องทำได้เหมือนเดิม
-- on delete set null: ประวัติการเคลื่อนไหวของสต็อกต้องไม่หายไปพร้อม Ticket ยอดคงเหลือที่คำนวณไว้แล้ว
-- จะผิดทันทีถ้าแถวใน ledger ถูกลบตาม
-- ============================================================================

alter table public.inventory_transactions
  add column ticket_id uuid references public.tickets(id) on delete set null;

create index inventory_transactions_ticket_id_idx
  on public.inventory_transactions (ticket_id, created_at desc)
  where ticket_id is not null;

comment on column public.inventory_transactions.ticket_id is
  'Ticket ที่เบิกอะไหล่ชิ้นนี้ไปใช้ (null = การเคลื่อนไหวคลังตามปกติที่ไม่ได้ผูกกับงานซ่อม)';

-- ----------------------------------------------------------------------------
-- ขยาย record_inventory_transaction ให้รับ ticket_id
--
-- ต้อง drop ก่อนสร้างใหม่ เพราะการเพิ่มพารามิเตอร์เปลี่ยน signature — ถ้าใช้ create or replace
-- เฉย ๆ จะได้ฟังก์ชันสองตัวซ้อนกัน และตัวเดิม (7 พารามิเตอร์) จะยังเรียกได้อยู่ ทำให้มีทางเบิกของ
-- ที่ข้ามการผูก Ticket ไปเงียบ ๆ
--
-- ticket_id_input มี default null เพื่อให้ผู้เรียกเดิมที่ส่ง 7 พารามิเตอร์ยังทำงานได้เหมือนเดิม
-- ตรรกะการล็อกแถว ตรวจสต็อกติดลบ และเขียน audit ยกมาจาก 20260915120000 ทั้งหมดโดยไม่เปลี่ยนความหมาย
-- ----------------------------------------------------------------------------
drop function if exists public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text);

create or replace function public.record_inventory_transaction(
  item_id_input uuid,
  transaction_type_input text,
  qty_input numeric,
  notes_input text,
  actor_id_input uuid,
  actor_email_input text,
  request_id_input text,
  ticket_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  locked_item public.inventory_items%rowtype;
  created_transaction public.inventory_transactions%rowtype;
  new_balance numeric;
begin
  if transaction_type_input not in ('IN', 'OUT') then
    raise exception using errcode = '22023', message = 'INVENTORY_INVALID_TRANSACTION_TYPE';
  end if;
  if qty_input is null or qty_input <= 0 then
    raise exception using errcode = '22023', message = 'INVENTORY_INVALID_QUANTITY';
  end if;
  if char_length(coalesce(notes_input, '')) > 500 then
    raise exception using errcode = '22001', message = 'INVENTORY_NOTES_TOO_LONG';
  end if;

  -- ตรวจ Ticket ที่อ้างถึงตั้งแต่ในทรานแซกชันเดียวกัน เพื่อให้ข้อความผิดพลาดบอกสาเหตุจริง
  -- แทนที่จะไปโผล่เป็น foreign key violation ดิบ ๆ ตอน insert
  if ticket_id_input is not null
     and not exists (select 1 from public.tickets t where t.id = ticket_id_input) then
    raise exception using errcode = 'P0002', message = 'INVENTORY_TICKET_NOT_FOUND';
  end if;

  select * into locked_item
  from public.inventory_items
  where id = item_id_input
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'INVENTORY_ITEM_NOT_FOUND';
  end if;

  new_balance := locked_item.stock_qty
    + case when transaction_type_input = 'IN' then qty_input else -qty_input end;

  if new_balance < 0 then
    raise exception using errcode = 'P0001', message = 'INVENTORY_INSUFFICIENT_STOCK';
  end if;

  update public.inventory_items
  set stock_qty = new_balance, updated_by = actor_id_input
  where id = item_id_input;

  insert into public.inventory_transactions (
    item_id, transaction_type, qty, balance_after, notes, created_by, ticket_id
  ) values (
    item_id_input, transaction_type_input, qty_input, new_balance,
    nullif(notes_input, ''), actor_id_input, ticket_id_input
  ) returning * into created_transaction;

  insert into public.audit_logs (
    actor_id, actor_email, action, module, target_table, target_id,
    detail, result, request_id
  ) values (
    actor_id_input, actor_email_input, transaction_type_input, 'inventory',
    'inventory_transactions', created_transaction.id::text,
    jsonb_build_object(
      'itemId', item_id_input, 'qty', qty_input, 'balanceAfter', new_balance,
      'ticketId', ticket_id_input
    ),
    'success', request_id_input
  );

  return jsonb_build_object(
    'transaction', to_jsonb(created_transaction),
    'balanceAfter', new_balance
  );
end;
$$;

-- สิทธิ์หายไปพร้อมกับ drop จึงต้องตั้งใหม่ให้ตรงกับ 20260915120000
-- เฉพาะ service role ของ Worker เท่านั้นที่เรียกได้ การตรวจสิทธิ์ยังทำที่ route ก่อนเรียกเสมอ
revoke all on function public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text, uuid)
  to service_role;

comment on function public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text, uuid)
  is 'Atomically locks stock, applies an IN/OUT movement, links it to a ticket when given, writes the ledger and audit log.';
