-- Dedicated company accounts for the Outsource Portal. These accounts are not
-- Supabase/internal users and therefore can never inherit employee RBAC roles.
create table public.vendor_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  email text not null check (char_length(btrim(email)) between 3 and 254),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 160),
  position text check (position is null or char_length(position) <= 160),
  password_hash text not null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  must_change_password boolean not null default false,
  failed_login_count integer not null default 0 check (failed_login_count between 0 and 1000),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index vendor_portal_accounts_vendor_email_uidx
  on public.vendor_portal_accounts (vendor_id, lower(btrim(email)));
create index vendor_portal_accounts_vendor_status_idx
  on public.vendor_portal_accounts (vendor_id, status);

create trigger trg_vendor_portal_accounts_set_updated_at
  before update on public.vendor_portal_accounts
  for each row execute function public.set_updated_at();

create table public.vendor_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.vendor_portal_accounts(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  ip_hash text,
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  created_at timestamptz not null default now()
);

create index vendor_portal_sessions_account_idx
  on public.vendor_portal_sessions (account_id, expires_at desc);
create index vendor_portal_sessions_expires_idx
  on public.vendor_portal_sessions (expires_at) where revoked_at is null;

-- Each submission is immutable from the company side. If IT requests a
-- revision, the company submits a new revision so the signed history remains.
create table public.ticket_outsource_submissions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  account_id uuid references public.vendor_portal_accounts(id) on delete set null,
  revision integer not null default 1 check (revision > 0),
  response jsonb not null,
  signature_storage_path text not null,
  signer_name text not null check (char_length(btrim(signer_name)) between 1 and 160),
  signer_position text check (signer_position is null or char_length(signer_position) <= 160),
  submitted_at timestamptz not null default now(),
  review_status text not null default 'Submitted' check (review_status in ('Submitted', 'Revision Requested', 'Accepted')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_id, revision)
);

create index ticket_outsource_submissions_ticket_idx
  on public.ticket_outsource_submissions (ticket_id, revision desc);
create index ticket_outsource_submissions_vendor_idx
  on public.ticket_outsource_submissions (vendor_id, submitted_at desc);

create trigger trg_ticket_outsource_submissions_set_updated_at
  before update on public.ticket_outsource_submissions
  for each row execute function public.set_updated_at();

create or replace function public.guard_ticket_outsource_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_vendor_id uuid;
  ticket_status text;
  account_vendor_id uuid;
begin
  select outsource_vendor_id, status into assigned_vendor_id, ticket_status
  from public.tickets where id = new.ticket_id;
  if assigned_vendor_id is null or assigned_vendor_id <> new.vendor_id then
    raise exception 'บริษัทไม่ตรงกับผู้รับงาน Outsource ของ Ticket';
  end if;
  if ticket_status <> 'ส่งต่อ Outsource' then
    raise exception 'บริษัทส่งผลได้เฉพาะ Ticket สถานะส่งต่อ Outsource';
  end if;
  if new.account_id is not null then
    select vendor_id into account_vendor_id from public.vendor_portal_accounts where id = new.account_id;
    if account_vendor_id is null or account_vendor_id <> new.vendor_id then
      raise exception 'บัญชีบริษัทไม่ตรงกับผู้รับงาน Outsource';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_ticket_outsource_submissions_guard
  before insert on public.ticket_outsource_submissions
  for each row execute function public.guard_ticket_outsource_submission();

alter table public.vendor_portal_accounts enable row level security;
alter table public.vendor_portal_sessions enable row level security;
alter table public.ticket_outsource_submissions enable row level security;

-- No anon/authenticated policies are intentional. All company access passes
-- through the Worker, which checks the opaque vendor session and vendor_id.

insert into storage.buckets (id, name, public, file_size_limit)
values ('ticket-outsource-signatures', 'ticket-outsource-signatures', false, 2097152)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- Add the company signature to section 3 without changing closed historical
-- forms. The current Form Studio template gets a real new version.
with updated_template as (
  update public.form_templates
  set content_html = replace(
        content_html,
        'ลงชื่อ {{vendor_assessor_name}}',
        'ลงชื่อ {{vendor_signature}}<br>{{vendor_assessor_name}}'
      ),
      current_version = current_version + 1,
      updated_at = now()
  where template_code = 'IT-ERP-ISSUE'
    and content_html not like '%{{vendor_signature}}%'
  returning *
)
insert into public.form_template_versions (
  template_id, version, name, description, content_html, page_settings, change_note, created_by
)
select
  id, current_version, name, description, content_html, page_settings,
  'เพิ่มลายเซ็นบริษัทในส่วนที่ 3', updated_by
from updated_template;

update public.issue_forms
set content_html = replace(
      content_html,
      'ลงชื่อ {{vendor_assessor_name}}',
      'ลงชื่อ {{vendor_signature}}<br>{{vendor_assessor_name}}'
    )
where status not in ('Closed', 'Cancelled')
  and content_html not like '%{{vendor_signature}}%';

comment on table public.vendor_portal_accounts is
  'Company contacts allowed to access only Tickets assigned to their vendor in the Outsource Portal.';
comment on table public.ticket_outsource_submissions is
  'Immutable signed company responses for section 3 of the repair form.';
