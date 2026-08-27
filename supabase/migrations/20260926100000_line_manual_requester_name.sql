-- LINE display names are provider metadata and must not be used as requester names.
-- Existing full_name values could only have come from the LINE callback before this migration,
-- so clear matching values and ask the user to enter their real name after the next login.
update public.line_users
set full_name = null
where full_name is not null
  and full_name = display_name;

comment on column public.line_users.full_name is
  'Requester name entered by the user after LINE Login; never populated from the LINE display name.';
