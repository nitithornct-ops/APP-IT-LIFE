-- Follow-up hardening: close task ownership gaps, make vendor lockout atomic,
-- and remove implicit execution rights from privileged helper/trigger functions.

revoke create on schema public from public, anon, authenticated;

alter function public.set_updated_at() set search_path = '';
alter function public.can_view_workflow_instance(uuid) set search_path = public, pg_temp;
alter function public.current_department_id() set search_path = public, pg_temp;
alter function public.has_permission(text) set search_path = public, pg_temp;
alter function public.has_role(text) set search_path = public, pg_temp;
alter function public.mark_knowledge_article_helpful(uuid) set search_path = public, pg_temp;
alter function public.my_permissions() set search_path = public, pg_temp;
alter function public.my_roles() set search_path = public, pg_temp;
alter function public.guard_helpdesk_ticket() set search_path = public, pg_temp;
alter function public.guard_ticket_outsource_submission() set search_path = public, pg_temp;
alter function public.guard_ticket_worklog_actor() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.prevent_last_super_admin_removal() set search_path = public, pg_temp;

revoke all on function public.can_view_workflow_instance(uuid) from public, anon;
revoke all on function public.current_department_id() from public, anon;
revoke all on function public.has_permission(text) from public, anon;
revoke all on function public.has_role(text) from public, anon;
revoke all on function public.mark_knowledge_article_helpful(uuid) from public, anon;
revoke all on function public.my_permissions() from public, anon;
revoke all on function public.my_roles() from public, anon;

grant execute on function public.can_view_workflow_instance(uuid) to authenticated, service_role;
grant execute on function public.current_department_id() to authenticated, service_role;
grant execute on function public.has_permission(text) to authenticated, service_role;
grant execute on function public.has_role(text) to authenticated, service_role;
grant execute on function public.mark_knowledge_article_helpful(uuid) to authenticated, service_role;
grant execute on function public.my_permissions() to authenticated, service_role;
grant execute on function public.my_roles() to authenticated, service_role;

revoke all on function public.capture_ticket_privacy_consent() from public, anon, authenticated;
revoke all on function public.enforce_change_workflow() from public, anon, authenticated;
revoke all on function public.enforce_incident_closure_gate() from public, anon, authenticated;
revoke all on function public.guard_helpdesk_ticket() from public, anon, authenticated;
revoke all on function public.guard_ticket_outsource_submission() from public, anon, authenticated;
revoke all on function public.guard_ticket_worklog_actor() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.prevent_last_super_admin_removal() from public, anon, authenticated;

-- A child row must always carry the same owner as its parent task. Existing production data was
-- checked before this migration was authored and contained zero mismatches in all three tables.
alter table public.personal_tasks
  add constraint personal_tasks_id_owner_id_key unique (id, owner_id);

alter table public.task_subtasks
  add constraint task_subtasks_task_owner_fk
  foreign key (task_id, owner_id) references public.personal_tasks (id, owner_id) on delete cascade;

alter table public.task_progress_logs
  add constraint task_progress_logs_task_owner_fk
  foreign key (task_id, owner_id) references public.personal_tasks (id, owner_id) on delete cascade;

alter table public.task_links
  add constraint task_links_task_owner_fk
  foreign key (task_id, owner_id) references public.personal_tasks (id, owner_id) on delete cascade;

create or replace function public.register_vendor_portal_login_failure(
  account_id_input uuid,
  failed_at_input timestamptz default now()
)
returns table (failed_login_count integer, locked_until timestamptz)
language sql
security definer
set search_path = ''
as $$
  update public.vendor_portal_accounts as account
  set
    failed_login_count = least(account.failed_login_count + 1, 1000),
    locked_until = case
      when account.failed_login_count + 1 >= 5
        then greatest(coalesce(account.locked_until, failed_at_input), failed_at_input + interval '15 minutes')
      else null
    end
  where account.id = account_id_input
  returning account.failed_login_count, account.locked_until;
$$;

create or replace function public.register_vendor_portal_login_success(
  account_id_input uuid,
  login_at_input timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  update public.vendor_portal_accounts as account
  set failed_login_count = 0, locked_until = null, last_login_at = login_at_input
  where account.id = account_id_input
    and (account.locked_until is null or account.locked_until <= login_at_input);
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.register_vendor_portal_login_failure(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.register_vendor_portal_login_success(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.register_vendor_portal_login_failure(uuid, timestamptz) to service_role;
grant execute on function public.register_vendor_portal_login_success(uuid, timestamptz) to service_role;
