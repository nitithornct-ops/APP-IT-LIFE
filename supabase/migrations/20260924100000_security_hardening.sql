-- Public article views are recorded only through the rate-limited Worker.
-- The Worker uses the service-role client; browser anon clients must not call
-- this SECURITY DEFINER function directly and inflate counters/storage.
revoke all on function public.record_knowledge_article_view(uuid, text) from anon;
grant execute on function public.record_knowledge_article_view(uuid, text) to authenticated, service_role;
