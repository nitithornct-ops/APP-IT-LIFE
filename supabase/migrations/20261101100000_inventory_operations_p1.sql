-- Inventory P1 operations: replenishment, reservations, requests, purchasing,
-- warehouse bins, barcode, cycle counts and approval-controlled adjustments.
-- All stock-changing operations below are service-role RPCs so the Worker is the
-- only trusted boundary that can mutate balances and immutable ledger rows.

create table if not exists public.inventory_warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_warehouses_code_check check (btrim(code) <> ''),
  constraint inventory_warehouses_name_check check (btrim(name) <> '')
);

create table if not exists public.inventory_bins (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete cascade,
  code text not null,
  name text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_bins_code_check check (btrim(code) <> ''),
  constraint inventory_bins_unique_code unique (warehouse_id, code)
);

create index if not exists inventory_bins_warehouse_idx on public.inventory_bins (warehouse_id, status, code);

alter table public.inventory_items
  add column if not exists reorder_point numeric not null default 0,
  add column if not exists low_stock_notification_enabled boolean not null default true,
  add column if not exists barcode text,
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null,
  add column if not exists warehouse_id uuid references public.inventory_warehouses(id) on delete set null,
  add column if not exists bin_id uuid references public.inventory_bins(id) on delete set null,
  add column if not exists valuation_method text not null default 'STANDARD'
    check (valuation_method in ('STANDARD', 'MOVING_AVERAGE')),
  add column if not exists last_purchase_price numeric check (last_purchase_price is null or last_purchase_price >= 0);

-- Preserve the meaning of the existing minimum-stock field for migrated rows.
update public.inventory_items
set reorder_point = min_qty
where reorder_point = 0 and min_qty > 0;

create unique index if not exists inventory_items_barcode_unique_idx
  on public.inventory_items (barcode)
  where barcode is not null and btrim(barcode) <> '';
create index if not exists inventory_items_reorder_point_idx on public.inventory_items (status, reorder_point, stock_qty);
create index if not exists inventory_items_vendor_idx on public.inventory_items (vendor_id);
create index if not exists inventory_items_warehouse_bin_idx on public.inventory_items (warehouse_id, bin_id);

create table if not exists public.inventory_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique default ('IR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  requester_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED')),
  reference_ticket_id uuid references public.tickets(id) on delete set null,
  reference_task_id uuid references public.personal_tasks(id) on delete set null,
  purpose text,
  approval_comment text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  fulfilled_by uuid references public.profiles(id) on delete set null,
  fulfilled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_requests_purpose_check check (purpose is null or char_length(purpose) <= 500)
);

create table if not exists public.inventory_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.inventory_requests(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  requested_qty numeric not null check (requested_qty > 0),
  issued_qty numeric not null default 0 check (issued_qty >= 0 and issued_qty <= requested_qty),
  notes text,
  created_at timestamptz not null default now(),
  constraint inventory_request_lines_request_item_unique unique (request_id, item_id)
);

create index if not exists inventory_requests_status_idx on public.inventory_requests (status, created_at desc);
create index if not exists inventory_requests_requester_idx on public.inventory_requests (requester_id, created_at desc);
create index if not exists inventory_request_lines_item_idx on public.inventory_request_lines (item_id, created_at desc);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  reserved_qty numeric not null check (reserved_qty > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'RELEASED', 'FULFILLED', 'CANCELLED')),
  reserved_by uuid not null references public.profiles(id) on delete restrict,
  source_request_id uuid references public.inventory_requests(id) on delete set null,
  reference_ticket_id uuid references public.tickets(id) on delete set null,
  reference_task_id uuid references public.personal_tasks(id) on delete set null,
  notes text,
  released_by uuid references public.profiles(id) on delete set null,
  released_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_reservations_item_active_idx
  on public.inventory_reservations (item_id, status, created_at desc);
create index if not exists inventory_reservations_request_idx
  on public.inventory_reservations (source_request_id, status);

alter table public.inventory_transactions
  add column if not exists task_id uuid references public.personal_tasks(id) on delete set null,
  add column if not exists purchase_receipt_id uuid;
create index if not exists inventory_transactions_task_idx
  on public.inventory_transactions (task_id, created_at desc)
  where task_id is not null;

create table if not exists public.inventory_purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  vendor_id uuid references public.vendors(id) on delete set null,
  purchase_order_no text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'POSTED', 'CANCELLED')),
  received_at timestamptz not null default now(),
  total_amount numeric not null default 0 check (total_amount >= 0),
  notes text,
  received_by uuid references public.profiles(id) on delete set null,
  posted_by uuid references public.profiles(id) on delete set null,
  posted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.inventory_purchase_receipts(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  received_qty numeric not null check (received_qty > 0),
  unit_price numeric not null default 0 check (unit_price >= 0),
  line_total numeric generated always as (received_qty * unit_price) stored,
  created_at timestamptz not null default now()
);

alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_purchase_receipt_id_fkey;
alter table public.inventory_transactions
  add constraint inventory_transactions_purchase_receipt_id_fkey
  foreign key (purchase_receipt_id) references public.inventory_purchase_receipts(id) on delete set null;

create index if not exists inventory_purchase_receipts_status_idx
  on public.inventory_purchase_receipts (status, received_at desc);
create index if not exists inventory_purchase_receipt_lines_item_idx
  on public.inventory_purchase_receipt_lines (item_id, created_at desc);

create table if not exists public.inventory_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  current_qty numeric not null check (current_qty >= 0),
  counted_qty numeric not null check (counted_qty >= 0),
  variance numeric generated always as (counted_qty - current_qty) stored,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  decision_comment text,
  reason text,
  source_campaign_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_adjustment_requests_status_idx
  on public.inventory_adjustment_requests (status, created_at desc);
create index if not exists inventory_adjustment_requests_item_idx
  on public.inventory_adjustment_requests (item_id, created_at desc);

create table if not exists public.inventory_cycle_count_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_code text not null unique,
  name text not null,
  scheduled_date date not null default current_date,
  warehouse_id uuid references public.inventory_warehouses(id) on delete set null,
  status text not null default 'ACTIVE' check (status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  created_by uuid references auth.users(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_cycle_count_campaigns_name_check check (btrim(name) <> '')
);

create table if not exists public.inventory_cycle_count_lines (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.inventory_cycle_count_campaigns(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  system_qty numeric not null check (system_qty >= 0),
  counted_qty numeric check (counted_qty is null or counted_qty >= 0),
  variance numeric generated always as (case when counted_qty is null then null else counted_qty - system_qty end) stored,
  status text not null default 'PENDING' check (status in ('PENDING', 'SUBMITTED', 'ADJUSTMENT_PENDING')),
  counted_by uuid references public.profiles(id) on delete set null,
  counted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_cycle_count_lines_campaign_item_unique unique (campaign_id, item_id)
);

alter table public.inventory_adjustment_requests
  drop constraint if exists inventory_adjustment_requests_campaign_fkey;
alter table public.inventory_adjustment_requests
  add constraint inventory_adjustment_requests_campaign_fkey
  foreign key (source_campaign_id) references public.inventory_cycle_count_campaigns(id) on delete set null;

create index if not exists inventory_cycle_count_campaigns_status_idx
  on public.inventory_cycle_count_campaigns (status, scheduled_date desc);
create index if not exists inventory_cycle_count_lines_campaign_idx
  on public.inventory_cycle_count_lines (campaign_id, status, item_id);

create table if not exists public.inventory_low_stock_alerts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.inventory_items(id) on delete cascade,
  stock_qty numeric not null,
  reorder_point numeric not null,
  last_notified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.permissions (key, module_key, action, description, status)
values ('inventory.approve', 'inventory', 'approve', 'อนุมัติหรือปฏิเสธการปรับยอดสต็อกและคำขอเบิก', 'active')
on conflict (key) do update set module_key = excluded.module_key, action = excluded.action,
  description = excluded.description, status = excluded.status;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r
cross join public.permissions p
where r.key in ('super_admin', 'it_admin', 'manager', 'approver')
  and p.key = 'inventory.approve'
on conflict (role_id, permission_id) do update set effect = excluded.effect;

create or replace function public.sync_inventory_low_stock_alert(item_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item_row public.inventory_items%rowtype;
begin
  select * into item_row from public.inventory_items where id = item_id_input;
  if not found then return; end if;

  if item_row.low_stock_notification_enabled and item_row.stock_qty <= item_row.reorder_point then
    insert into public.inventory_low_stock_alerts (item_id, stock_qty, reorder_point, resolved_at)
    values (item_row.id, item_row.stock_qty, item_row.reorder_point, null)
    on conflict (item_id) do update set stock_qty = excluded.stock_qty,
      reorder_point = excluded.reorder_point, resolved_at = null, updated_at = now();
  else
    update public.inventory_low_stock_alerts
    set resolved_at = coalesce(resolved_at, now()), updated_at = now()
    where item_id = item_row.id and resolved_at is null;
  end if;
end;
$$;

-- Replace the previous 7/8 argument function with a backward-compatible 9 argument
-- version. The new task argument has a default, so old callers remain valid.
drop function if exists public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text, uuid);
drop function if exists public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text);

create or replace function public.record_inventory_transaction(
  item_id_input uuid,
  transaction_type_input text,
  qty_input numeric,
  notes_input text,
  actor_id_input uuid,
  actor_email_input text,
  request_id_input text,
  ticket_id_input uuid default null,
  task_id_input uuid default null
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
  active_reserved numeric;
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
  if ticket_id_input is not null and not exists (select 1 from public.tickets where id = ticket_id_input) then
    raise exception using errcode = 'P0002', message = 'INVENTORY_TICKET_NOT_FOUND';
  end if;
  if task_id_input is not null and not exists (select 1 from public.personal_tasks where id = task_id_input) then
    raise exception using errcode = 'P0002', message = 'INVENTORY_TASK_NOT_FOUND';
  end if;

  select * into locked_item from public.inventory_items where id = item_id_input for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'INVENTORY_ITEM_NOT_FOUND';
  end if;

  new_balance := locked_item.stock_qty + case when transaction_type_input = 'IN' then qty_input else -qty_input end;
  select coalesce(sum(reserved_qty), 0) into active_reserved
  from public.inventory_reservations where item_id = item_id_input and status = 'ACTIVE';
  if new_balance < 0 then
    raise exception using errcode = 'P0001', message = 'INVENTORY_INSUFFICIENT_STOCK';
  end if;
  if transaction_type_input = 'OUT' and new_balance < active_reserved then
    raise exception using errcode = 'P0001', message = 'INVENTORY_INSUFFICIENT_AVAILABLE';
  end if;

  update public.inventory_items set stock_qty = new_balance, updated_by = actor_id_input where id = item_id_input;
  insert into public.inventory_transactions (item_id, transaction_type, qty, balance_after, notes, created_by, ticket_id, task_id)
  values (item_id_input, transaction_type_input, qty_input, new_balance, nullif(notes_input, ''), actor_id_input, ticket_id_input, task_id_input)
  returning * into created_transaction;
  perform public.sync_inventory_low_stock_alert(item_id_input);

  insert into public.audit_logs (actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
  values (actor_id_input, actor_email_input, transaction_type_input, 'inventory', 'inventory_transactions', created_transaction.id::text,
    jsonb_build_object('itemId', item_id_input, 'qty', qty_input, 'balanceAfter', new_balance,
      'ticketId', ticket_id_input, 'taskId', task_id_input), 'success', request_id_input);

  return jsonb_build_object('transaction', to_jsonb(created_transaction), 'balanceAfter', new_balance);
end;
$$;

create or replace function public.create_inventory_request(
  requester_id_input uuid,
  purpose_input text,
  ticket_id_input uuid,
  task_id_input uuid,
  lines_input jsonb,
  actor_email_input text,
  request_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_request public.inventory_requests%rowtype;
  line_value jsonb;
  line_item_id uuid;
  line_qty numeric;
begin
  if coalesce(jsonb_array_length(lines_input), 0) = 0 then
    raise exception using errcode = '22023', message = 'INVENTORY_REQUEST_EMPTY';
  end if;
  if char_length(coalesce(purpose_input, '')) > 500 then
    raise exception using errcode = '22001', message = 'INVENTORY_PURPOSE_TOO_LONG';
  end if;
  insert into public.inventory_requests (requester_id, purpose, reference_ticket_id, reference_task_id, created_by)
  values (requester_id_input, nullif(purpose_input, ''), ticket_id_input, task_id_input, requester_id_input)
  returning * into created_request;

  for line_value in select value from jsonb_array_elements(lines_input)
  loop
    begin
      line_item_id := (line_value->>'itemId')::uuid;
      line_qty := (line_value->>'qty')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'INVENTORY_REQUEST_LINE_INVALID';
    end;
    if line_qty is null or line_qty <= 0 then
      raise exception using errcode = '22023', message = 'INVENTORY_REQUEST_LINE_INVALID';
    end if;
    if not exists (select 1 from public.inventory_items where id = line_item_id and status = 'active') then
      raise exception using errcode = 'P0002', message = 'INVENTORY_ITEM_NOT_FOUND';
    end if;
    insert into public.inventory_request_lines (request_id, item_id, requested_qty, notes)
    values (created_request.id, line_item_id, line_qty, nullif(line_value->>'notes', ''));
  end loop;

  insert into public.audit_logs (actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
  values (requester_id_input, actor_email_input, 'CREATE', 'inventory', 'inventory_requests', created_request.id::text,
    jsonb_build_object('requestNo', created_request.request_no, 'lineCount', jsonb_array_length(lines_input)), 'success', request_id_input);
  return jsonb_build_object('request', to_jsonb(created_request));
end;
$$;

create or replace function public.approve_inventory_request(
  request_id_input uuid,
  approved_input boolean,
  actor_id_input uuid,
  actor_email_input text,
  request_trace_input text,
  comment_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.inventory_requests%rowtype;
  line_row record;
  locked_item public.inventory_items%rowtype;
  active_reserved numeric;
  available_qty numeric;
  reservation_row public.inventory_reservations%rowtype;
begin
  select * into request_row from public.inventory_requests where id = request_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_REQUEST_NOT_FOUND'; end if;
  if request_row.status <> 'PENDING' then raise exception using errcode = '22023', message = 'INVENTORY_REQUEST_NOT_PENDING'; end if;
  if not approved_input then
    update public.inventory_requests set status = 'REJECTED', approval_comment = nullif(comment_input, ''), approved_by = actor_id_input,
      approved_at = now(), updated_by = actor_id_input where id = request_id_input returning * into request_row;
  else
    for line_row in select * from public.inventory_request_lines where request_id = request_id_input order by id
    loop
      select * into locked_item from public.inventory_items where id = line_row.item_id for update;
      select coalesce(sum(reserved_qty), 0) into active_reserved
      from public.inventory_reservations where item_id = line_row.item_id and status = 'ACTIVE';
      available_qty := locked_item.stock_qty - active_reserved;
      if available_qty < line_row.requested_qty then
        raise exception using errcode = 'P0001', message = 'INVENTORY_REQUEST_INSUFFICIENT_AVAILABLE';
      end if;
      insert into public.inventory_reservations (item_id, reserved_qty, reserved_by, source_request_id,
        reference_ticket_id, reference_task_id, notes)
      values (line_row.item_id, line_row.requested_qty, request_row.requester_id, request_row.id,
        request_row.reference_ticket_id, request_row.reference_task_id, 'Reserved for ' || request_row.request_no)
      returning * into reservation_row;
    end loop;
    update public.inventory_requests set status = 'APPROVED', approval_comment = nullif(comment_input, ''), approved_by = actor_id_input,
      approved_at = now(), updated_by = actor_id_input where id = request_id_input returning * into request_row;
  end if;

  insert into public.audit_logs (actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
  values (actor_id_input, actor_email_input, case when approved_input then 'APPROVE' else 'REJECT' end, 'inventory',
    'inventory_requests', request_id_input::text, jsonb_build_object('approved', approved_input, 'comment', comment_input), 'success', request_trace_input);
  return jsonb_build_object('request', to_jsonb(request_row));
end;
$$;

create or replace function public.fulfill_inventory_request(
  request_id_input uuid,
  actor_id_input uuid,
  actor_email_input text,
  request_trace_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.inventory_requests%rowtype;
  line_row record;
  reservation_row public.inventory_reservations%rowtype;
  locked_item public.inventory_items%rowtype;
  new_balance numeric;
  created_transaction public.inventory_transactions%rowtype;
begin
  select * into request_row from public.inventory_requests where id = request_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_REQUEST_NOT_FOUND'; end if;
  if request_row.status <> 'APPROVED' then raise exception using errcode = '22023', message = 'INVENTORY_REQUEST_NOT_APPROVED'; end if;

  for line_row in select * from public.inventory_request_lines where request_id = request_id_input order by id
  loop
    select * into reservation_row from public.inventory_reservations
    where source_request_id = request_id_input and item_id = line_row.item_id and status = 'ACTIVE'
    order by created_at desc limit 1 for update;
    if not found then raise exception using errcode = '22023', message = 'INVENTORY_REQUEST_RESERVATION_MISSING'; end if;
    select * into locked_item from public.inventory_items where id = line_row.item_id for update;
    if locked_item.stock_qty < line_row.requested_qty then
      raise exception using errcode = 'P0001', message = 'INVENTORY_INSUFFICIENT_STOCK';
    end if;
    new_balance := locked_item.stock_qty - line_row.requested_qty;
    update public.inventory_items set stock_qty = new_balance, updated_by = actor_id_input where id = locked_item.id;
    insert into public.inventory_transactions (item_id, transaction_type, qty, balance_after, notes, created_by,
      ticket_id, task_id)
    values (locked_item.id, 'OUT', line_row.requested_qty, new_balance,
      coalesce('Issue request ' || request_row.request_no || case when request_row.purpose is null then '' else ': ' || request_row.purpose end,
        'Issue request ' || request_row.request_no), actor_id_input, request_row.reference_ticket_id, request_row.reference_task_id)
    returning * into created_transaction;
    update public.inventory_reservations set status = 'FULFILLED', fulfilled_at = now(), updated_at = now()
      where id = reservation_row.id;
    update public.inventory_request_lines set issued_qty = requested_qty where id = line_row.id;
    perform public.sync_inventory_low_stock_alert(locked_item.id);
    insert into public.audit_logs (actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
    values (actor_id_input, actor_email_input, 'OUT', 'inventory', 'inventory_transactions', created_transaction.id::text,
      jsonb_build_object('requestId', request_id_input, 'itemId', locked_item.id, 'qty', line_row.requested_qty,
        'balanceAfter', new_balance), 'success', request_trace_input);
  end loop;

  update public.inventory_requests set status = 'FULFILLED', fulfilled_by = actor_id_input, fulfilled_at = now(), updated_by = actor_id_input
    where id = request_id_input returning * into request_row;
  return jsonb_build_object('request', to_jsonb(request_row));
end;
$$;

create or replace function public.reserve_inventory(
  item_id_input uuid,
  reserved_qty_input numeric,
  reserved_by_input uuid,
  actor_email_input text,
  request_id_input text,
  ticket_id_input uuid default null,
  task_id_input uuid default null,
  source_request_id_input uuid default null,
  notes_input text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  locked_item public.inventory_items%rowtype;
  reservation_row public.inventory_reservations%rowtype;
  active_reserved numeric;
begin
  if reserved_qty_input is null or reserved_qty_input <= 0 then
    raise exception using errcode = '22023', message = 'INVENTORY_INVALID_QUANTITY';
  end if;
  if ticket_id_input is not null and not exists (select 1 from public.tickets where id = ticket_id_input) then
    raise exception using errcode = 'P0002', message = 'INVENTORY_TICKET_NOT_FOUND';
  end if;
  if task_id_input is not null and not exists (select 1 from public.personal_tasks where id = task_id_input) then
    raise exception using errcode = 'P0002', message = 'INVENTORY_TASK_NOT_FOUND';
  end if;
  select * into locked_item from public.inventory_items where id = item_id_input and status = 'active' for update;
  if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_ITEM_NOT_FOUND'; end if;
  select coalesce(sum(reserved_qty), 0) into active_reserved
    from public.inventory_reservations where item_id = item_id_input and status = 'ACTIVE';
  if locked_item.stock_qty - active_reserved < reserved_qty_input then
    raise exception using errcode = 'P0001', message = 'INVENTORY_RESERVATION_INSUFFICIENT_AVAILABLE';
  end if;
  insert into public.inventory_reservations (item_id, reserved_qty, reserved_by, source_request_id,
    reference_ticket_id, reference_task_id, notes)
  values (item_id_input, reserved_qty_input, reserved_by_input, source_request_id_input,
    ticket_id_input, task_id_input, nullif(notes_input, '')) returning * into reservation_row;
  insert into public.audit_logs (actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
  values (reserved_by_input, actor_email_input, 'RESERVE', 'inventory', 'inventory_reservations', reservation_row.id::text,
    jsonb_build_object('itemId', item_id_input, 'qty', reserved_qty_input, 'ticketId', ticket_id_input, 'taskId', task_id_input), 'success', request_id_input);
  return to_jsonb(reservation_row);
end;
$$;

create or replace function public.release_inventory_reservation(
  reservation_id_input uuid,
  actor_id_input uuid,
  actor_email_input text,
  request_trace_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reservation_row public.inventory_reservations%rowtype;
begin
  select * into reservation_row from public.inventory_reservations where id = reservation_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_RESERVATION_NOT_FOUND'; end if;
  if reservation_row.status <> 'ACTIVE' then raise exception using errcode = '22023', message = 'INVENTORY_RESERVATION_NOT_ACTIVE'; end if;
  update public.inventory_reservations set status = 'RELEASED', released_by = actor_id_input, released_at = now(), updated_at = now()
    where id = reservation_id_input returning * into reservation_row;
  insert into public.audit_logs (actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
  values (actor_id_input, actor_email_input, 'RELEASE', 'inventory', 'inventory_reservations', reservation_id_input::text,
    jsonb_build_object('itemId', reservation_row.item_id, 'qty', reservation_row.reserved_qty), 'success', request_trace_input);
  return to_jsonb(reservation_row);
end;
$$;

create or replace function public.approve_inventory_adjustment(
  adjustment_id_input uuid,
  approved_input boolean,
  actor_id_input uuid,
  actor_email_input text,
  request_trace_input text,
  comment_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.inventory_adjustment_requests%rowtype;
  result_row jsonb;
begin
  select * into request_row from public.inventory_adjustment_requests where id = adjustment_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_ADJUSTMENT_NOT_FOUND'; end if;
  if request_row.status <> 'PENDING' then raise exception using errcode = '22023', message = 'INVENTORY_ADJUSTMENT_NOT_PENDING'; end if;
  if approved_input then
    if exists (select 1 from public.inventory_items where id = request_row.item_id and stock_qty <> request_row.current_qty) then
      raise exception using errcode = '40001', message = 'INVENTORY_ADJUSTMENT_STALE';
    end if;
    select public.adjust_inventory_stock(request_row.item_id, request_row.counted_qty,
      coalesce(nullif(comment_input, ''), 'Approved stock adjustment'), actor_id_input, actor_email_input, request_trace_input)
      into result_row;
    update public.inventory_adjustment_requests set status = 'APPROVED', approved_by = actor_id_input,
      approved_at = now(), decision_comment = nullif(comment_input, ''), updated_at = now() where id = adjustment_id_input returning * into request_row;
    perform public.sync_inventory_low_stock_alert(request_row.item_id);
  else
    update public.inventory_adjustment_requests set status = 'REJECTED', approved_by = actor_id_input,
      approved_at = now(), decision_comment = nullif(comment_input, ''), updated_at = now() where id = adjustment_id_input returning * into request_row;
  end if;
  insert into public.audit_logs (actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
  values (actor_id_input, actor_email_input, case when approved_input then 'APPROVE' else 'REJECT' end, 'inventory',
    'inventory_adjustment_requests', adjustment_id_input::text, jsonb_build_object('approved', approved_input, 'comment', comment_input), 'success', request_trace_input);
  return jsonb_build_object('adjustment', to_jsonb(request_row), 'adjustmentResult', result_row);
end;
$$;

create or replace function public.post_inventory_purchase_receipt(
  receipt_id_input uuid,
  actor_id_input uuid,
  actor_email_input text,
  request_trace_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  receipt_row public.inventory_purchase_receipts%rowtype;
  line_row record;
  locked_item public.inventory_items%rowtype;
  new_balance numeric;
  created_transaction public.inventory_transactions%rowtype;
begin
  select * into receipt_row from public.inventory_purchase_receipts where id = receipt_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_RECEIPT_NOT_FOUND'; end if;
  if receipt_row.status <> 'DRAFT' then raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_NOT_DRAFT'; end if;
  for line_row in select * from public.inventory_purchase_receipt_lines where receipt_id = receipt_id_input order by id
  loop
    select * into locked_item from public.inventory_items where id = line_row.item_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_ITEM_NOT_FOUND'; end if;
    new_balance := locked_item.stock_qty + line_row.received_qty;
    update public.inventory_items set stock_qty = new_balance, last_purchase_price = line_row.unit_price, updated_by = actor_id_input
      where id = locked_item.id;
    insert into public.inventory_transactions (item_id, transaction_type, qty, balance_after, notes, created_by, purchase_receipt_id)
    values (locked_item.id, 'IN', line_row.received_qty, new_balance, 'Purchase receipt ' || receipt_row.receipt_no,
      actor_id_input, receipt_id_input) returning * into created_transaction;
    perform public.sync_inventory_low_stock_alert(locked_item.id);
    insert into public.audit_logs (actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
    values (actor_id_input, actor_email_input, 'IN', 'inventory', 'inventory_transactions', created_transaction.id::text,
      jsonb_build_object('receiptId', receipt_id_input, 'itemId', locked_item.id, 'qty', line_row.received_qty,
        'unitPrice', line_row.unit_price, 'balanceAfter', new_balance), 'success', request_trace_input);
  end loop;
  update public.inventory_purchase_receipts set status = 'POSTED', posted_by = actor_id_input, posted_at = now(),
    received_by = coalesce(received_by, actor_id_input), updated_by = actor_id_input where id = receipt_id_input returning * into receipt_row;
  return jsonb_build_object('receipt', to_jsonb(receipt_row));
end;
$$;

create or replace function public.create_inventory_cycle_count_campaign(
  name_input text,
  scheduled_date_input date,
  warehouse_id_input uuid,
  item_ids_input jsonb,
  actor_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  campaign_row public.inventory_cycle_count_campaigns%rowtype;
  item_id_value uuid;
  item_row public.inventory_items%rowtype;
  code_value text;
begin
  if coalesce(jsonb_array_length(item_ids_input), 0) = 0 then
    raise exception using errcode = '22023', message = 'INVENTORY_CYCLE_COUNT_EMPTY';
  end if;
  code_value := 'CC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.inventory_cycle_count_campaigns (campaign_code, name, scheduled_date, warehouse_id, created_by)
  values (code_value, name_input, coalesce(scheduled_date_input, current_date), warehouse_id_input, actor_id_input)
  returning * into campaign_row;
  for item_id_value in select distinct (value #>> '{}')::uuid from jsonb_array_elements(item_ids_input)
  loop
    select * into item_row from public.inventory_items where id = item_id_value and status = 'active';
    if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_ITEM_NOT_FOUND'; end if;
    insert into public.inventory_cycle_count_lines (campaign_id, item_id, system_qty)
    values (campaign_row.id, item_row.id, item_row.stock_qty);
  end loop;
  return jsonb_build_object('campaign', to_jsonb(campaign_row));
end;
$$;

create or replace function public.submit_inventory_cycle_count(
  campaign_id_input uuid,
  item_id_input uuid,
  counted_qty_input numeric,
  actor_id_input uuid,
  notes_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  line_row public.inventory_cycle_count_lines%rowtype;
begin
  if counted_qty_input is null or counted_qty_input < 0 then
    raise exception using errcode = '22023', message = 'INVENTORY_INVALID_COUNT';
  end if;
  update public.inventory_cycle_count_lines set counted_qty = counted_qty_input, status = 'SUBMITTED',
    counted_by = actor_id_input, counted_at = now(), notes = nullif(notes_input, ''), updated_at = now()
    where campaign_id = campaign_id_input and item_id = item_id_input
    returning * into line_row;
  if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_CYCLE_COUNT_LINE_NOT_FOUND'; end if;
  return to_jsonb(line_row);
end;
$$;

create or replace function public.complete_inventory_cycle_count(
  campaign_id_input uuid,
  actor_id_input uuid,
  actor_email_input text,
  request_trace_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  campaign_row public.inventory_cycle_count_campaigns%rowtype;
  line_row record;
  adjustment_count integer := 0;
begin
  select * into campaign_row from public.inventory_cycle_count_campaigns where id = campaign_id_input for update;
  if not found then raise exception using errcode = 'P0002', message = 'INVENTORY_CYCLE_COUNT_NOT_FOUND'; end if;
  if campaign_row.status <> 'ACTIVE' then raise exception using errcode = '22023', message = 'INVENTORY_CYCLE_COUNT_NOT_ACTIVE'; end if;
  if exists (select 1 from public.inventory_cycle_count_lines where campaign_id = campaign_id_input and counted_qty is null) then
    raise exception using errcode = '22023', message = 'INVENTORY_CYCLE_COUNT_INCOMPLETE';
  end if;
  for line_row in select * from public.inventory_cycle_count_lines where campaign_id = campaign_id_input and variance <> 0
  loop
    insert into public.inventory_adjustment_requests (item_id, current_qty, counted_qty, requested_by, source_campaign_id)
    values (line_row.item_id, line_row.system_qty, line_row.counted_qty, actor_id_input, campaign_id_input);
    update public.inventory_cycle_count_lines set status = 'ADJUSTMENT_PENDING', updated_at = now() where id = line_row.id;
    adjustment_count := adjustment_count + 1;
  end loop;
  update public.inventory_cycle_count_campaigns set status = 'COMPLETED', completed_by = actor_id_input,
    completed_at = now(), updated_at = now() where id = campaign_id_input returning * into campaign_row;
  insert into public.audit_logs (actor_id, actor_email, action, module, target_table, target_id, detail, result, request_id)
  values (actor_id_input, actor_email_input, 'COMPLETE', 'inventory', 'inventory_cycle_count_campaigns', campaign_id_input::text,
    jsonb_build_object('adjustmentCount', adjustment_count), 'success', request_trace_input);
  return jsonb_build_object('campaign', to_jsonb(campaign_row), 'adjustmentCount', adjustment_count);
end;
$$;

revoke all on function public.sync_inventory_low_stock_alert(uuid) from public, anon, authenticated;
revoke all on function public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_inventory_request(uuid, text, uuid, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.approve_inventory_request(uuid, boolean, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.fulfill_inventory_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_inventory_reservation(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.reserve_inventory(uuid, numeric, uuid, text, text, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.approve_inventory_adjustment(uuid, boolean, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.post_inventory_purchase_receipt(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_inventory_cycle_count_campaign(text, date, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.submit_inventory_cycle_count(uuid, uuid, numeric, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_inventory_cycle_count(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.sync_inventory_low_stock_alert(uuid) to service_role;
grant execute on function public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text, uuid, uuid) to service_role;
grant execute on function public.create_inventory_request(uuid, text, uuid, uuid, jsonb, text, text) to service_role;
grant execute on function public.approve_inventory_request(uuid, boolean, uuid, text, text, text) to service_role;
grant execute on function public.fulfill_inventory_request(uuid, uuid, text, text) to service_role;
grant execute on function public.release_inventory_reservation(uuid, uuid, text, text) to service_role;
grant execute on function public.reserve_inventory(uuid, numeric, uuid, text, text, uuid, uuid, uuid, text) to service_role;
grant execute on function public.approve_inventory_adjustment(uuid, boolean, uuid, text, text, text) to service_role;
grant execute on function public.post_inventory_purchase_receipt(uuid, uuid, text, text) to service_role;
grant execute on function public.create_inventory_cycle_count_campaign(text, date, uuid, jsonb, uuid) to service_role;
grant execute on function public.submit_inventory_cycle_count(uuid, uuid, numeric, uuid, text) to service_role;
grant execute on function public.complete_inventory_cycle_count(uuid, uuid, text, text) to service_role;

alter table public.inventory_warehouses enable row level security;
alter table public.inventory_bins enable row level security;
alter table public.inventory_requests enable row level security;
alter table public.inventory_request_lines enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.inventory_purchase_receipts enable row level security;
alter table public.inventory_purchase_receipt_lines enable row level security;
alter table public.inventory_adjustment_requests enable row level security;
alter table public.inventory_cycle_count_campaigns enable row level security;
alter table public.inventory_cycle_count_lines enable row level security;
alter table public.inventory_low_stock_alerts enable row level security;

drop policy if exists inventory_warehouses_select_with_permission on public.inventory_warehouses;
create policy inventory_warehouses_select_with_permission on public.inventory_warehouses
  for select to authenticated using (public.has_permission('inventory.view'));
drop policy if exists inventory_warehouses_write_with_permission on public.inventory_warehouses;
create policy inventory_warehouses_write_with_permission on public.inventory_warehouses
  for all to authenticated using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));

drop policy if exists inventory_bins_select_with_permission on public.inventory_bins;
create policy inventory_bins_select_with_permission on public.inventory_bins
  for select to authenticated using (public.has_permission('inventory.view'));
drop policy if exists inventory_bins_write_with_permission on public.inventory_bins;
create policy inventory_bins_write_with_permission on public.inventory_bins
  for all to authenticated using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));

drop policy if exists inventory_requests_select_own_or_with_permission on public.inventory_requests;
create policy inventory_requests_select_own_or_with_permission on public.inventory_requests
  for select to authenticated using (requester_id = auth.uid() or public.has_permission('inventory.view'));

drop policy if exists inventory_request_lines_select_visible_request on public.inventory_request_lines;
create policy inventory_request_lines_select_visible_request on public.inventory_request_lines
  for select to authenticated using (exists (select 1 from public.inventory_requests r where r.id = request_id));

drop policy if exists inventory_reservations_select_with_permission on public.inventory_reservations;
create policy inventory_reservations_select_with_permission on public.inventory_reservations
  for select to authenticated using (public.has_permission('inventory.view'));

drop policy if exists inventory_purchase_receipts_select_with_permission on public.inventory_purchase_receipts;
create policy inventory_purchase_receipts_select_with_permission on public.inventory_purchase_receipts
  for select to authenticated using (public.has_permission('inventory.view'));

drop policy if exists inventory_purchase_receipt_lines_select_with_permission on public.inventory_purchase_receipt_lines;
create policy inventory_purchase_receipt_lines_select_with_permission on public.inventory_purchase_receipt_lines
  for select to authenticated using (public.has_permission('inventory.view'));

drop policy if exists inventory_adjustment_requests_select_with_permission on public.inventory_adjustment_requests;
create policy inventory_adjustment_requests_select_with_permission on public.inventory_adjustment_requests
  for select to authenticated using (public.has_permission('inventory.view'));
drop policy if exists inventory_adjustment_requests_insert_with_permission on public.inventory_adjustment_requests;
create policy inventory_adjustment_requests_insert_with_permission on public.inventory_adjustment_requests
  for insert to authenticated with check (public.has_permission('inventory.manage'));

drop policy if exists inventory_cycle_count_campaigns_select_with_permission on public.inventory_cycle_count_campaigns;
create policy inventory_cycle_count_campaigns_select_with_permission on public.inventory_cycle_count_campaigns
  for select to authenticated using (public.has_permission('inventory.view'));
drop policy if exists inventory_cycle_count_campaigns_write_with_permission on public.inventory_cycle_count_campaigns;
create policy inventory_cycle_count_campaigns_write_with_permission on public.inventory_cycle_count_campaigns
  for all to authenticated using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));

drop policy if exists inventory_cycle_count_lines_select_with_permission on public.inventory_cycle_count_lines;
create policy inventory_cycle_count_lines_select_with_permission on public.inventory_cycle_count_lines
  for select to authenticated using (public.has_permission('inventory.view'));

drop policy if exists inventory_low_stock_alerts_select_with_permission on public.inventory_low_stock_alerts;
create policy inventory_low_stock_alerts_select_with_permission on public.inventory_low_stock_alerts
  for select to authenticated using (public.has_permission('inventory.view'));

comment on table public.inventory_reservations is 'Quantity held out of available stock but not yet issued.';
comment on table public.inventory_adjustment_requests is 'Approval queue for physical count or manual stock changes.';
comment on table public.inventory_purchase_receipts is 'Posted receipts create IN ledger rows atomically.';
comment on column public.inventory_items.valuation_method is 'STANDARD uses unit_price; MOVING_AVERAGE uses last_purchase_price as the current cost basis.';
