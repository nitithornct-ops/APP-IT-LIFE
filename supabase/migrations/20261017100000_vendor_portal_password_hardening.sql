-- Require every Vendor Portal contact to replace an administrator-issued password
-- before accessing tickets or submitting signed work.
alter table public.vendor_portal_accounts
  alter column must_change_password set default true;

update public.vendor_portal_accounts
set must_change_password = true,
    updated_at = now()
where status = 'Active';

comment on column public.vendor_portal_accounts.must_change_password is
  'Forces a Vendor Portal contact to replace an administrator-issued password before portal access.';
