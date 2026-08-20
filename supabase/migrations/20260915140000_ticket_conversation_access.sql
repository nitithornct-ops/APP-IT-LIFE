-- Browser sessions may append public comments/worklogs only. Internal notes must pass
-- the Worker permission check and are then written with the service role.
drop policy if exists ticket_worklogs_insert_staff on public.ticket_worklogs;

create policy ticket_worklogs_insert_staff on public.ticket_worklogs
  for insert to authenticated
  with check (
    public.has_permission('ticket.update')
    and actor_id = auth.uid()
    and (
      (entry_type in ('timeline', 'worklog') and is_public)
      or (entry_type = 'comment' and is_public and public.has_permission('ticket.comment'))
    )
    and exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_worklogs.ticket_id
        and (
          ticket.assignee_id = auth.uid()
          or public.has_permission('ticket.view_all')
        )
    )
  );

comment on policy ticket_worklogs_insert_staff on public.ticket_worklogs is
  'Public conversation/worklogs only; internal_note writes are Worker-only after ticket.internal_note validation.';
