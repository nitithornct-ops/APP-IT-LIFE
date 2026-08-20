-- Guest reporters do not have an auth.users identity.  Keep their files private,
-- but allow the API to record who/where the upload came from after validating the
-- Ticket tracking token.
alter table public.file_attachments
  add column uploader_label text;

alter table public.file_attachments
  alter column uploaded_by drop not null;

alter table public.file_attachments
  add constraint file_attachments_uploader_identity_check
  check (uploaded_by is not null or nullif(trim(uploader_label), '') is not null);

comment on column public.file_attachments.uploader_label is
  'Human-readable uploader identity for trusted server-side uploads without an auth.users account.';
