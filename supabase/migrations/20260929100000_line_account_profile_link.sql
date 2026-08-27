-- Allow an administrator to connect a LINE identity to exactly one application profile.
-- The link is optional: LINE-only requesters can continue to use the public portal without
-- an application account, while linked profiles can receive LINE pushes for web tickets too.

create unique index if not exists line_users_linked_user_id_unique
  on public.line_users (linked_user_id)
  where linked_user_id is not null;

comment on column public.line_users.linked_user_id is
  'Application profile selected by an administrator for this LINE identity; unique when set so notifications have one unambiguous LINE recipient.';

update public.permissions
set description = 'ตรวจสอบ เชื่อมผู้ใช้ ระงับ และเปิดใช้งานบัญชี LINE Service Portal'
where key = 'line.manage';
