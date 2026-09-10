-- Vendor Portal accounts use a username for authentication. Email remains a
-- required contact field but is no longer used as the login identifier.

alter table public.vendor_portal_accounts
  add column if not exists username text;

-- Preserve access for existing accounts by deriving a safe, deterministic
-- username from the email local part and an account-specific suffix.
with source as (
  select
    id,
    nullif(
      regexp_replace(lower(split_part(btrim(email), '@', 1)), '[^a-z0-9._-]+', '_', 'g'),
      ''
    ) as base_username
  from public.vendor_portal_accounts
  where username is null
), candidates as (
  select
    id,
    left(case when char_length(base_username) >= 3 then base_username else 'vendor' end, 23)
      || '_' || substr(md5(id::text), 1, 8) as username
  from source
)
update public.vendor_portal_accounts as account
set username = candidates.username
from candidates
where account.id = candidates.id;

alter table public.vendor_portal_accounts
  add constraint vendor_portal_accounts_username_format
  check (username ~ '^[a-z0-9._-]{3,32}$');

alter table public.vendor_portal_accounts
  alter column username set not null;

create unique index vendor_portal_accounts_vendor_username_uidx
  on public.vendor_portal_accounts (vendor_id, lower(btrim(username)));

comment on column public.vendor_portal_accounts.username is
  'Username used with vendor_code and password to access the Outsource Portal.';
