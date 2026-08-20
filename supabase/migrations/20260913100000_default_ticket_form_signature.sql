-- One private PNG signature configured once and inherited by every Ticket form.

insert into public.system_settings
  (key, value, description, group_key, value_type, options, is_editable, support_status, sort_order)
values
  ('TICKET_FORM_SIGNATURE_PATH', '', 'ตำแหน่งไฟล์ลายเซ็นกลางสำหรับแบบฟอร์ม Ticket', 'General', 'text', '[]', false, 'active', 25)
on conflict (key) do update set
  description = excluded.description,
  group_key = excluded.group_key,
  value_type = excluded.value_type,
  options = excluded.options,
  is_editable = excluded.is_editable,
  support_status = excluded.support_status,
  sort_order = excluded.sort_order;

comment on column public.tickets.signature_storage_path is
  'Optional private PNG override for this Ticket; blank Tickets inherit TICKET_FORM_SIGNATURE_PATH.';
