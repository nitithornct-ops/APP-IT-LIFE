-- Security / PDPA hardening: preserve the exact consent presented on public Ticket
-- surfaces. The evidence is written in the same transaction as the Ticket and copied
-- into the governed privacy_consents register by a database trigger.

alter table public.privacy_consents
  add column consented_at timestamptz,
  add column consent_text text,
  add column source_table text,
  add column source_record_id uuid;

update public.privacy_consents
set consented_at = granted_at::timestamp at time zone 'UTC',
    consent_text = coalesce(nullif(notes, ''), '[legacy consent text was not captured]')
where consented_at is null or consent_text is null;

alter table public.privacy_consents
  alter column consented_at set not null,
  alter column consent_text set not null,
  add constraint privacy_consents_source_pair_check check (
    (source_table is null and source_record_id is null)
    or (source_table is not null and source_record_id is not null)
  );

create unique index privacy_consents_source_record_idx
  on public.privacy_consents (source_table, source_record_id)
  where source_table is not null and source_record_id is not null;

alter table public.tickets
  add column privacy_consent_confirmed boolean not null default false,
  add column privacy_notice_version text,
  add column privacy_consent_at timestamptz,
  add column privacy_consent_channel text,
  add column privacy_consent_text text,
  add column privacy_anonymized_at timestamptz;

-- Historical public routes already required privacyConsent=true, but did not retain the
-- rendered version/text. Mark that limitation explicitly instead of fabricating evidence.
update public.tickets
set privacy_consent_confirmed = true,
    privacy_notice_version = 'legacy-unversioned',
    privacy_consent_at = created_at,
    privacy_consent_channel = case source_channel
      when 'guest' then 'PUBLIC_TICKET_WEB'
      when 'line' then 'PUBLIC_TICKET_LINE'
    end,
    privacy_consent_text = '[legacy affirmative consent recorded; exact rendered text was not retained]'
where source_channel in ('guest', 'line');

alter table public.tickets
  add constraint tickets_public_consent_evidence_check check (
    source_channel not in ('guest', 'line')
    or (
      privacy_consent_confirmed
      and nullif(btrim(privacy_notice_version), '') is not null
      and privacy_consent_at is not null
      and privacy_consent_channel in ('PUBLIC_TICKET_WEB', 'PUBLIC_TICKET_LINE')
      and nullif(btrim(privacy_consent_text), '') is not null
    )
  );

comment on column public.tickets.privacy_notice_version is
  'Immutable snapshot version of the notice accepted when a public/LINE Ticket was submitted.';
comment on column public.tickets.privacy_consent_at is
  'Server timestamp for affirmative Ticket consent; never supplied by the browser.';
comment on column public.tickets.privacy_consent_channel is
  'Server-selected capture surface: PUBLIC_TICKET_WEB or PUBLIC_TICKET_LINE.';
comment on column public.tickets.privacy_consent_text is
  'Exact consent statement rendered for and accepted by the requester.';
comment on column public.tickets.privacy_anonymized_at is
  'Set by the automated PDPA retention process after files and direct identifiers are removed.';

insert into public.privacy_consents (
  consent_code, data_subject_ref, purpose, notice_version, channel, granted_at,
  status, consented_at, consent_text, source_table, source_record_id,
  created_at, updated_at, created_by, updated_by
)
select
  'CNS-TKT-' || replace(ticket.id::text, '-', ''),
  'ticket:' || ticket.ticket_no,
  'รับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม และแจ้งสถานะ Ticket',
  ticket.privacy_notice_version,
  ticket.privacy_consent_channel,
  ticket.privacy_consent_at::date,
  'ใช้งาน',
  ticket.privacy_consent_at,
  ticket.privacy_consent_text,
  'tickets',
  ticket.id,
  ticket.created_at,
  ticket.created_at,
  ticket.created_by,
  ticket.created_by
from public.tickets ticket
where ticket.privacy_consent_confirmed
  and ticket.source_channel in ('guest', 'line')
  and not exists (
    select 1 from public.privacy_consents consent
    where consent.source_table = 'tickets' and consent.source_record_id = ticket.id
  );

create or replace function public.capture_ticket_privacy_consent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source_channel in ('guest', 'line') and new.privacy_consent_confirmed then
    insert into public.privacy_consents (
      consent_code, data_subject_ref, purpose, notice_version, channel, granted_at,
      status, consented_at, consent_text, source_table, source_record_id,
      created_at, updated_at, created_by, updated_by
    ) values (
      'CNS-TKT-' || replace(new.id::text, '-', ''),
      'ticket:' || new.ticket_no,
      'รับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม และแจ้งสถานะ Ticket',
      new.privacy_notice_version,
      new.privacy_consent_channel,
      new.privacy_consent_at::date,
      'ใช้งาน',
      new.privacy_consent_at,
      new.privacy_consent_text,
      'tickets',
      new.id,
      new.created_at,
      new.created_at,
      new.created_by,
      new.created_by
    ) on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_tickets_capture_privacy_consent
  after insert on public.tickets
  for each row execute function public.capture_ticket_privacy_consent();

create or replace function public.protect_ticket_consent_evidence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.source_table = 'tickets' then
    if tg_op = 'DELETE' then
      raise exception 'TICKET_CONSENT_EVIDENCE_IMMUTABLE';
    end if;
    if new.data_subject_ref is distinct from old.data_subject_ref
       or new.purpose is distinct from old.purpose
       or new.notice_version is distinct from old.notice_version
       or new.channel is distinct from old.channel
       or new.granted_at is distinct from old.granted_at
       or new.consented_at is distinct from old.consented_at
       or new.consent_text is distinct from old.consent_text
       or new.source_table is distinct from old.source_table
       or new.source_record_id is distinct from old.source_record_id then
      raise exception 'TICKET_CONSENT_EVIDENCE_IMMUTABLE';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger trg_privacy_consents_protect_ticket_evidence
  before update or delete on public.privacy_consents
  for each row execute function public.protect_ticket_consent_evidence();
