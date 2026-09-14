-- Vendor & Contract P0/P1 extensions.
-- Vendor Portal credentials are moved to Supabase Auth. The Worker only grants
-- portal access to a mapped Auth user with an AAL2 session.

alter table public.vendors
  add column if not exists criticality_tier text not null default 'Medium'
    check (criticality_tier in ('Low', 'Medium', 'High', 'Critical')),
  add column if not exists vendor_risk_assessment text,
  add column if not exists security_assessment text,
  add column if not exists dpa_status text not null default 'Not Assessed'
    check (dpa_status in ('Not Assessed', 'Not Required', 'Pending', 'Approved', 'Expired', 'Rejected')),
  add column if not exists nda_status text not null default 'Not Assessed'
    check (nda_status in ('Not Assessed', 'Not Required', 'Pending', 'Active', 'Expired', 'Rejected')),
  add column if not exists data_access text,
  add column if not exists systems_accessed text[] not null default '{}'::text[],
  add column if not exists sla text,
  add column if not exists incident_contact text,
  add column if not exists escalation_contact text,
  add column if not exists performance_review text,
  add column if not exists annual_review text,
  add column if not exists performance_review_date date,
  add column if not exists annual_review_date date;

create index if not exists vendors_criticality_tier_idx on public.vendors (criticality_tier);
create index if not exists vendors_dpa_status_idx on public.vendors (dpa_status);

update public.vendors
set vendor_risk_assessment = assessment_result
where vendor_risk_assessment is null and assessment_result is not null;

alter table public.contracts
  add column if not exists budget numeric
    check (budget is null or budget >= 0),
  add column if not exists annual_cost numeric
    check (annual_cost is null or annual_cost >= 0),
  add column if not exists auto_renewal boolean not null default false,
  add column if not exists sla_ola text,
  add column if not exists dpa_attachment_id uuid references public.file_attachments(id) on delete set null,
  add column if not exists security_clause text,
  add column if not exists renewal_decision text not null default 'Pending'
    check (renewal_decision in ('Pending', 'Renew', 'Do Not Renew', 'Renegotiate', 'Terminate')),
  add column if not exists termination_checklist jsonb not null default '[]'::jsonb
    check (jsonb_typeof(termination_checklist) = 'array');

-- Existing contracts may use the old free-form notice value. Normalize before
-- enforcing the P0/P1 policy of 30/60/90 days.
update public.contracts
set renewal_notice_days = 30
where renewal_notice_days not in (30, 60, 90);

alter table public.contracts
  drop constraint if exists contracts_renewal_notice_days_check;
alter table public.contracts
  add constraint contracts_renewal_notice_days_check
  check (renewal_notice_days in (30, 60, 90));

create index if not exists contracts_renewal_decision_idx on public.contracts (renewal_decision);
create index if not exists contracts_dpa_attachment_id_idx on public.contracts (dpa_attachment_id)
  where dpa_attachment_id is not null;

create table if not exists public.contract_assets (
  contract_id uuid not null references public.contracts(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (contract_id, asset_id)
);

create table if not exists public.contract_licenses (
  contract_id uuid not null references public.contracts(id) on delete cascade,
  license_id uuid not null references public.software_licenses(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (contract_id, license_id)
);

create table if not exists public.contract_configuration_items (
  contract_id uuid not null references public.contracts(id) on delete cascade,
  configuration_item_id uuid not null references public.configuration_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (contract_id, configuration_item_id)
);

create index if not exists contract_assets_asset_idx on public.contract_assets (asset_id);
create index if not exists contract_licenses_license_idx on public.contract_licenses (license_id);
create index if not exists contract_configuration_items_ci_idx on public.contract_configuration_items (configuration_item_id);

alter table public.contract_assets enable row level security;
alter table public.contract_licenses enable row level security;
alter table public.contract_configuration_items enable row level security;

create policy contract_assets_select_with_permission on public.contract_assets
  for select to authenticated using (public.has_permission('contract.view'));
create policy contract_assets_write_with_permission on public.contract_assets
  for all to authenticated using (public.has_permission('contract.manage'))
  with check (public.has_permission('contract.manage'));
create policy contract_licenses_select_with_permission on public.contract_licenses
  for select to authenticated using (public.has_permission('contract.view'));
create policy contract_licenses_write_with_permission on public.contract_licenses
  for all to authenticated using (public.has_permission('contract.manage'))
  with check (public.has_permission('contract.manage'));
create policy contract_configuration_items_select_with_permission on public.contract_configuration_items
  for select to authenticated using (public.has_permission('contract.view'));
create policy contract_configuration_items_write_with_permission on public.contract_configuration_items
  for all to authenticated using (public.has_permission('contract.manage'))
  with check (public.has_permission('contract.manage'));

-- Remove the old custom password path without deleting the column during a
-- rolling deployment. The new Worker never reads or writes this column.
alter table public.vendor_portal_accounts
  alter column password_hash drop not null,
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists invite_status text not null default 'Pending'
    check (invite_status in ('Pending', 'Accepted', 'Revoked')),
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists mfa_enrolled_at timestamptz;

update public.vendor_portal_accounts
set password_hash = null,
    invite_status = case when status = 'Active' then 'Pending' else 'Revoked' end,
    accepted_at = null,
    mfa_enrolled_at = null;

create index if not exists vendor_portal_accounts_auth_user_idx
  on public.vendor_portal_accounts (auth_user_id) where auth_user_id is not null;
create index if not exists vendor_portal_accounts_invite_status_idx
  on public.vendor_portal_accounts (invite_status, invited_at);

-- Auth users for the external portal must not become internal profiles or
-- inherit employee RBAC through the generic new-user trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.raw_user_meta_data ->> 'account_type' = 'vendor_portal' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name, username, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    'active'
  );
  return new;
end;
$$;

comment on column public.vendor_portal_accounts.password_hash is
  'Deprecated. Vendor Portal authentication uses Supabase Auth; this legacy value is cleared and must remain unused.';
comment on column public.vendor_portal_accounts.auth_user_id is
  'Supabase Auth identity for the external contact. Access requires an AAL2 session.';
comment on column public.vendor_portal_accounts.invite_status is
  'Pending until the recipient accepts the invite, sets a password and completes MFA.';
