-- ============================================================================
-- LINE Login public ticket portal — decision gate resolved 2026-08-10 (docs/migration/
-- phase0-migration_roadmap.md § Decision Gates). Legacy: LineAuth.gs + docs/06_SETUP_LINE_OA_TICKET.md.
--
-- LINE users are never Supabase Auth users — they have no JWT, so every LINE-facing
-- endpoint runs on the service-role client with authorization enforced in application code
-- (requireActiveLineSession equivalent), the same pattern the legacy system used. RLS on
-- these tables is therefore service-role-only, matching public.line_users already.
-- ============================================================================

create table public.line_sessions (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null unique,
  line_user_id uuid not null references public.line_users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index line_sessions_line_user_id_idx on public.line_sessions (line_user_id);
create index line_sessions_expires_at_idx on public.line_sessions (expires_at);

alter table public.line_sessions enable row level security;

-- Legacy LinkStatus values (LineAuth.gs upsertLineUser_/linkLineEmployeePublic): Pending, Active,
-- Suspended, Unlinked. Nullable because migrated rows may predate this constraint.
alter table public.line_users add constraint line_users_link_status_check
  check (link_status is null or link_status in ('Pending', 'Active', 'Suspended', 'Unlinked'));

-- Ticket/worklog columns for the LINE channel (legacy: Tickets.RequesterIdentityType/
-- RequesterLineUserID/SourceChannel, Ticket_Worklogs.ActorIdentityType/ActorLineUserID).
-- requester_id/actor_id stay NOT NULL and always resolve to the linked profile — LINE ticket
-- actions require an Active employee link first (requireActiveLineSession_), so a real profile
-- always exists by the time a ticket/worklog row is written. These new columns only record
-- which LINE identity to push notifications to, not an alternate requester/actor identity.
alter table public.tickets add column requester_line_user_id uuid references public.line_users(id) on delete set null;
alter table public.tickets add column source_channel text not null default 'web' check (source_channel in ('web', 'line'));
create index tickets_requester_line_user_id_idx on public.tickets (requester_line_user_id);

alter table public.ticket_worklogs add column actor_line_user_id uuid references public.line_users(id) on delete set null;
create index ticket_worklogs_actor_line_user_id_idx on public.ticket_worklogs (actor_line_user_id);

comment on column public.tickets.requester_line_user_id is 'Set when source_channel = line; used to target push notifications, not for authorization.';
comment on column public.ticket_worklogs.actor_line_user_id is 'Set when the worklog actor acted via the LINE portal, for display/notification purposes only.';

-- Delivery history for LINE Messaging API pushes (legacy: NotificationLog rows with Channel=LINE).
-- Separate from public.notifications (the in-app bell, recipient_id not null references profiles) —
-- a failed push to a team room has no single profile recipient, and this table is a log, not an inbox.
create table public.line_notification_log (
  id uuid primary key default gen_random_uuid(),
  line_user_id uuid references public.line_users(id) on delete set null,
  to_target text not null,
  message text not null,
  success boolean not null,
  error text,
  created_at timestamptz not null default now()
);

create index line_notification_log_line_user_id_idx on public.line_notification_log (line_user_id);
create index line_notification_log_created_at_idx on public.line_notification_log (created_at desc);

alter table public.line_notification_log enable row level security;

-- Admin review/approval of pending LINE-employee links (legacy: "IT Admin ตรวจและอนุมัติจากหลังบ้าน").
-- Granted to technician too, matching the precedent set in Module 8 (Asset) of extending
-- ITAdmin-only legacy modules to technician as well, since day-to-day ticket handling and LINE
-- link review both sit with the same Help Desk staff.
insert into public.permissions (key, module_key, action, description, status) values
  ('line.manage', 'line', 'manage', 'อนุมัติ/ระงับการผูกบัญชี LINE กับพนักงาน', 'active')
on conflict (key) do update set description = excluded.description, status = excluded.status;

insert into public.role_permissions (role_id, permission_id, effect)
select r.id, p.id, 'allow'
from public.roles r cross join public.permissions p
where r.key in ('super_admin', 'it_admin', 'technician') and p.key = 'line.manage'
on conflict (role_id, permission_id) do update set effect = 'allow';
