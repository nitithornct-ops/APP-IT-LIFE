-- Organization branding: public logo assets are managed only by Settings administrators.
insert into storage.buckets (id, name, public, file_size_limit)
values ('branding', 'branding', true, 2097152)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists branding_select_public on storage.objects;
create policy branding_select_public on storage.objects
  for select to public
  using (bucket_id = 'branding');

drop policy if exists branding_insert_with_permission on storage.objects;
create policy branding_insert_with_permission on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = 'organization'
    and public.has_permission('setting.manage')
  );

drop policy if exists branding_update_with_permission on storage.objects;
create policy branding_update_with_permission on storage.objects
  for update to authenticated
  using (bucket_id = 'branding' and public.has_permission('setting.manage'))
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = 'organization'
    and public.has_permission('setting.manage')
  );

drop policy if exists branding_delete_with_permission on storage.objects;
create policy branding_delete_with_permission on storage.objects
  for delete to authenticated
  using (bucket_id = 'branding' and public.has_permission('setting.manage'));

insert into public.system_settings
  (key, value, description, group_key, value_type, options, is_editable, support_status, sort_order)
values
  ('ORG_LOGO_URL', '', 'โลโก้หน่วยงานที่แสดงในส่วนแบรนด์ของระบบ', 'General', 'url', '[]', false, 'active', 20)
on conflict (key) do update set
  description = excluded.description,
  group_key = excluded.group_key,
  value_type = excluded.value_type,
  options = excluded.options,
  is_editable = excluded.is_editable,
  support_status = excluded.support_status,
  sort_order = excluded.sort_order;
