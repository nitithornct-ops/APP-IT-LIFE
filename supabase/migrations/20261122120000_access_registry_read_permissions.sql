-- The registry page is available to reviewers and auditors as well as managers.
-- This grants read only; existing write policies remain restricted to managers.
drop policy if exists user_access_registry_select_own_or_staff on public.user_access_registry;
create policy user_access_registry_select_own_or_staff on public.user_access_registry
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_permission('access_request.view')
    or public.has_permission('access_registry.manage')
    or public.has_permission('access_registry.review')
    or public.has_permission('audit.view')
  );
