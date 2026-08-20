-- Keep inventory balance, ledger and its security audit in one database transaction.
-- Only the Worker service role may call these functions; route permission checks happen
-- before the service-role call and every write is still attributed to the authenticated user.

create or replace function public.record_inventory_transaction(
  item_id_input uuid,
  transaction_type_input text,
  qty_input numeric,
  notes_input text,
  actor_id_input uuid,
  actor_email_input text,
  request_id_input text
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
    item_id, transaction_type, qty, balance_after, notes, created_by
  ) values (
    item_id_input, transaction_type_input, qty_input, new_balance,
    nullif(notes_input, ''), actor_id_input
  ) returning * into created_transaction;

  insert into public.audit_logs (
    actor_id, actor_email, action, module, target_table, target_id,
    detail, result, request_id
  ) values (
    actor_id_input, actor_email_input, transaction_type_input, 'inventory',
    'inventory_transactions', created_transaction.id::text,
    jsonb_build_object('itemId', item_id_input, 'qty', qty_input, 'balanceAfter', new_balance),
    'success', request_id_input
  );

  return jsonb_build_object(
    'transaction', to_jsonb(created_transaction),
    'balanceAfter', new_balance
  );
end;
$$;

create or replace function public.adjust_inventory_stock(
  item_id_input uuid,
  counted_input numeric,
  notes_input text,
  actor_id_input uuid,
  actor_email_input text,
  request_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  locked_item public.inventory_items%rowtype;
  created_transaction public.inventory_transactions%rowtype;
  stock_variance numeric;
  ledger_notes text;
begin
  if counted_input is null or counted_input < 0 then
    raise exception using errcode = '22023', message = 'INVENTORY_INVALID_COUNT';
  end if;
  if char_length(coalesce(notes_input, '')) > 500 then
    raise exception using errcode = '22001', message = 'INVENTORY_NOTES_TOO_LONG';
  end if;

  select * into locked_item
  from public.inventory_items
  where id = item_id_input
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'INVENTORY_ITEM_NOT_FOUND';
  end if;

  stock_variance := counted_input - locked_item.stock_qty;
  ledger_notes := format('From %s -> %s%s', locked_item.stock_qty, counted_input,
    case when nullif(notes_input, '') is null then '' else ' - ' || notes_input end);

  update public.inventory_items
  set stock_qty = counted_input, updated_by = actor_id_input
  where id = item_id_input;

  insert into public.inventory_transactions (
    item_id, transaction_type, qty, balance_after, variance, notes, created_by
  ) values (
    item_id_input, 'ADJUST', abs(stock_variance), counted_input, stock_variance,
    ledger_notes, actor_id_input
  ) returning * into created_transaction;

  insert into public.audit_logs (
    actor_id, actor_email, action, module, target_table, target_id,
    detail, result, request_id
  ) values (
    actor_id_input, actor_email_input, 'ADJUST', 'inventory',
    'inventory_transactions', created_transaction.id::text,
    jsonb_build_object('itemId', item_id_input, 'counted', counted_input, 'variance', stock_variance),
    'success', request_id_input
  );

  return jsonb_build_object(
    'transaction', to_jsonb(created_transaction),
    'balanceAfter', counted_input,
    'variance', stock_variance
  );
end;
$$;

revoke all on function public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.adjust_inventory_stock(uuid, numeric, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text)
  to service_role;
grant execute on function public.adjust_inventory_stock(uuid, numeric, text, uuid, text, text)
  to service_role;

comment on function public.record_inventory_transaction(uuid, text, numeric, text, uuid, text, text)
  is 'Atomically locks stock, applies an IN/OUT movement, writes the ledger and audit log.';
comment on function public.adjust_inventory_stock(uuid, numeric, text, uuid, text, text)
  is 'Atomically locks stock, applies a stocktake adjustment, writes the ledger and audit log.';
