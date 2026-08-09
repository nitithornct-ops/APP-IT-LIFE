-- ============================================================================
-- Phase 6 Module 14: Software License Management
--
-- Module 8 created the initial software_licenses table as part of the Asset
-- consolidation. This migration completes the standalone License lifecycle:
-- a human-readable code, renewal notice policy, idempotent notification marker,
-- legacy ID reconciliation, and a database-level date-range invariant.
-- ============================================================================

alter table public.software_licenses
  add column license_code text,
  add column expiry_notice_days smallint not null default 30
    check (expiry_notice_days between 0 and 3650),
  add column expiry_notified_at timestamptz,
  add column legacy_id text;

update public.software_licenses
set license_code = 'LIC-MIG-' || upper(substr(md5(id::text), 1, 10))
where license_code is null;

alter table public.software_licenses
  alter column license_code set not null,
  alter column license_code set default ('LIC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  add constraint software_licenses_license_code_unique unique (license_code),
  add constraint software_licenses_date_range_valid
    check (start_date is null or expire_date is null or expire_date >= start_date);

create index software_licenses_expire_date_idx on public.software_licenses (expire_date);
create index software_licenses_vendor_status_idx on public.software_licenses (vendor_id, status);
