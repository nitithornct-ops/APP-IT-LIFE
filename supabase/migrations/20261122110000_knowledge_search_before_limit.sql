-- Search through all visible rows before ranking and limiting results.
-- SECURITY INVOKER preserves RLS for internal callers; the API uses the
-- service role for the public portal and always sets public_only_input.
create or replace function public.search_knowledge_article_ids(
  search_input text,
  taxonomy_id_input uuid,
  category_id_input uuid,
  status_input text,
  public_only_input boolean,
  today_input date,
  limit_input integer
) returns table(id uuid)
language sql stable
security invoker
set search_path = ''
as $$
  select a.id
  from public.knowledge_articles a
  left join public.ticket_categories category on category.id = a.category_id
  left join public.knowledge_taxonomies taxonomy on taxonomy.id = a.taxonomy_id
  where (taxonomy_id_input is null or a.taxonomy_id = taxonomy_id_input)
    and (taxonomy_id_input is not null or category_id_input is null or a.category_id = category_id_input)
    and (status_input is null or a.status = status_input)
    and (not public_only_input or (a.status = 'เผยแพร่' and not coalesce(a.is_deprecated, false)
      and (a.expiry_date is null or a.expiry_date >= today_input)))
    and (nullif(search_input, '') is null or position(lower(search_input) in lower(concat_ws(' ',
      a.title, a.symptom, a.solution, array_to_string(a.tags, ' '), array_to_string(a.synonyms, ' '), category.name, taxonomy.name))) > 0)
  order by a.search_rank desc, a.views_count desc, a.id asc
  limit least(greatest(coalesce(limit_input, 0), 0), 501);
$$;
revoke all on function public.search_knowledge_article_ids(text,uuid,uuid,text,boolean,date,integer) from public, anon;
grant execute on function public.search_knowledge_article_ids(text,uuid,uuid,text,boolean,date,integer) to authenticated, service_role;
