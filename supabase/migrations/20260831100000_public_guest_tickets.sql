-- ============================================================================
-- Public (no-login) ticket report page — unblocked now that R-11 (LINE Login) is resolved.
-- Legacy: PublicTicket.html + Module_TicketExtras.gs (submitTicketPublic_). Module 4's original
-- migration explicitly deferred this ("ต้องรอ LINE Channel Secret... และต้องออกแบบ auth แยกทาง
-- สำหรับ public เทียบกับ authenticated") — this migration is that follow-up design.
--
-- Unlike the LINE portal (which requires an Active employee link before a ticket can be created,
-- so requester_id always resolves to a real profile), this page accepts submissions from anyone
-- with zero identity proof: a typed name/phone only. That means requester_id can't be required
-- here, so it becomes nullable and a parallel "guest identity" is added instead. Guest tickets are
-- written by the Worker's service-role client (never RLS-authenticated), matching the LINE portal's
-- established pattern — see routes/publicTickets.ts.
-- ============================================================================

alter table public.tickets alter column requester_id drop not null;
alter table public.ticket_worklogs alter column actor_id drop not null;

alter table public.tickets drop constraint tickets_source_channel_check;
alter table public.tickets add constraint tickets_source_channel_check check (source_channel in ('web', 'line', 'guest'));

-- Guest identity (only set when source_channel = 'guest'); requester_phone already existed as
-- free text and is reused as-is for the guest's contact number.
alter table public.tickets add column guest_name text;
alter table public.tickets add column guest_department text;

-- SHA-256 hex digest of a 32-byte random token shown to the guest exactly once at submission time
-- (the "รหัสติดตาม" they must save) — the raw token is never stored, only its hash, so a leaked
-- database row can't be used to impersonate a guest's status lookup. Matches the hashClientId
-- pattern already used for public KB analytics in routes/knowledge.ts.
alter table public.tickets add column public_tracking_token_hash text;
create unique index tickets_public_tracking_token_hash_idx on public.tickets (public_tracking_token_hash) where public_tracking_token_hash is not null;

alter table public.tickets add constraint tickets_requester_identity_check check (
  requester_id is not null or (guest_name is not null and public_tracking_token_hash is not null)
);

-- Worklog rows written for a guest ticket (e.g. the automatic "เปิด Ticket" entry) have no actor
-- profile either — actor_label carries a display string ("ผู้แจ้งผ่านหน้าสาธารณะ") instead.
alter table public.ticket_worklogs add column actor_label text;
alter table public.ticket_worklogs add constraint ticket_worklogs_actor_identity_check check (
  actor_id is not null or actor_line_user_id is not null or actor_label is not null
);

comment on column public.tickets.guest_name is 'Set when source_channel = guest: the name typed on the public no-login report form.';
comment on column public.tickets.public_tracking_token_hash is 'SHA-256 hex of the one-time tracking token shown to a guest at submission; null for web/line tickets.';
comment on column public.ticket_worklogs.actor_label is 'Display label for worklogs with no actor_id/actor_line_user_id (guest-submitted tickets).';
