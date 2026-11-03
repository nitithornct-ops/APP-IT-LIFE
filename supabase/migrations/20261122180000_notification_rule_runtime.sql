-- Evaluate rules at the database fan-out boundary, including notifications
-- created by existing SLA/reminder RPCs. Rules apply to new events only.
alter table public.notifications
  add column policy_suppressed boolean not null default false,
  add column visible_at timestamptz not null default now(),
  add column event_context jsonb not null default '{}'::jsonb,
  add column policy_error text;

create policy notifications_delivery_visibility on public.notifications as restrictive
  for select to authenticated using (not policy_suppressed and visible_at <= now());

create function public.notification_event_key(type_input text) returns text
language sql immutable set search_path = '' as $$
  select case
    when type_input = 'access_request_approval_needed' then 'access_request.created'
    when type_input like 'ticket_%' then 'ticket.' || substr(type_input, 8)
    when type_input like 'access_request_%' then 'access_request.' || substr(type_input, 16)
    when type_input in ('change_requested','change_approval_result','change_deployed') then 'change.updated'
    when type_input like 'backup_%' and type_input ~* 'fail' then 'backup.failed'
    else type_input end;
$$;

create function public.notification_rule_for(type_input text, channel_input text)
returns public.notification_rules language sql stable security definer set search_path = '' as $$
  select r from public.notification_rules r
  where r.event_key in (type_input, public.notification_event_key(type_input)) and r.channel = channel_input
    and r.module_key = case split_part(public.notification_event_key(type_input),'.',1)
      when 'ticket' then 'tickets' when 'access_request' then 'access_requests'
      when 'change' then 'changes' when 'backup' then 'backup_monitoring'
      else split_part(public.notification_event_key(type_input),'.',1) end
    -- These labels describe recipients already resolved/authorized by the event producer.
    -- This runtime never expands an event to an arbitrary account or external group.
    and r.recipient in ('event.recipient','LINE requester','Approver group','IT operations')
  order by r.priority, r.rule_code limit 1;
$$;
revoke all on function public.notification_rule_for(text,text) from public, anon, authenticated;

create function public.notification_after_quiet_hours(quiet jsonb, at_time timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare local_now timestamp; start_time time; end_time time; quiet_end timestamp; zone text;
begin
  if not coalesce((quiet->>'enabled')::boolean, false) then return at_time; end if;
  zone := quiet->>'timezone'; local_now := at_time at time zone zone;
  if zone is null or quiet->>'start' is null or quiet->>'end' is null then return at_time; end if;
  start_time := (quiet->>'start')::time; end_time := (quiet->>'end')::time;
  if start_time = end_time then return at_time; end if;
  if (start_time < end_time and local_now::time >= start_time and local_now::time < end_time)
    or (start_time > end_time and (local_now::time >= start_time or local_now::time < end_time)) then
    quiet_end := local_now::date + end_time;
    if quiet_end <= local_now then quiet_end := quiet_end + interval '1 day'; end if;
    return quiet_end at time zone zone;
  end if;
  return at_time;
exception when invalid_parameter_value or invalid_datetime_format then return at_time;
end;
$$;

create function public.notification_render_template(template_input text, variables_input jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare result text := template_input; placeholder text;
begin
  if template_input is null then return null; end if;
  for placeholder in select distinct (regexp_matches(template_input, '\{\{([a-zA-Z0-9_]+)\}\}', 'g'))[1] loop
    if not (variables_input ? placeholder) then return null; end if;
    result := replace(result, '{{' || placeholder || '}}', coalesce(variables_input->>placeholder, ''));
  end loop;
  return replace(result, E'\\n', E'\n');
end;
$$;

create function public.apply_notification_rule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rule public.notification_rules; template public.notification_templates;
  variables jsonb; rendered text; ticket_variables jsonb; linked_id text;
begin
  variables := new.event_context || jsonb_build_object('title',new.title,'body',coalesce(new.body,''),
    'type',new.type,'link',coalesce(new.link,''),'recipient_id',new.recipient_id);
  if new.type like 'ticket_%' then
    linked_id := substring(coalesce(new.link,'') from '/tickets/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');
    if linked_id is not null then
      select jsonb_build_object('ticket_no',t.ticket_no,'title',t.title,'status',t.status,
        'assignee',coalesce(t.assignee_name_snapshot,'')) into ticket_variables
      from public.tickets t where t.id = linked_id::uuid;
      variables := variables || coalesce(ticket_variables,'{}'::jsonb);
    end if;
  end if;
  new.event_context := variables || jsonb_build_object('__title',new.title,'__body',new.body);
  rule := public.notification_rule_for(new.type, 'in-app');
  if rule.id is null then return new; end if;
  new.policy_suppressed := not rule.enabled;
  if not rule.enabled then return new; end if;
  new.visible_at := public.notification_after_quiet_hours(rule.quiet_hours, now());
  if rule.template_id is not null then
    select * into template from public.notification_templates where id = rule.template_id and status = 'ACTIVE' and channel = 'in-app';
    if not found then new.policy_error := 'TEMPLATE_NOT_ACTIVE'; return new; end if;
    rendered := public.notification_render_template(template.body, variables);
    if rendered is null then new.policy_error := 'MISSING_TEMPLATE_VARIABLE'; return new; end if;
    new.body := rendered;
    if template.subject is not null then
      rendered := public.notification_render_template(template.subject, variables);
      if rendered is not null then new.title := rendered; else new.policy_error := 'MISSING_TEMPLATE_VARIABLE'; end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.apply_notification_rule() from public, anon, authenticated;
create trigger trg_notifications_apply_rule before insert on public.notifications
  for each row execute function public.apply_notification_rule();

create or replace function public.enqueue_line_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rule public.notification_rules; template public.notification_templates; rendered text;
  title text; body text; next_at timestamptz := now(); attempts integer := 5;
  policy jsonb := '{}'::jsonb; outbox_id uuid; escalation_target uuid;
begin
  rule := public.notification_rule_for(new.type, 'line-messaging');
  title := coalesce(new.event_context->>'__title',new.title);
  body := coalesce(new.event_context->>'__body',new.body);
  if rule.id is not null then
    if not rule.enabled then return new; end if;
    next_at := public.notification_after_quiet_hours(rule.quiet_hours, now());
    attempts := greatest(1, least(20, coalesce((rule.retry_policy->>'maxAttempts')::integer,5)));
    policy := jsonb_build_object('ruleId',rule.id,'backoffSeconds',greatest(1,least(86400,coalesce((rule.retry_policy->>'backoffSeconds')::integer,60))),
      'fallbackChannel',rule.fallback_channel);
    if rule.template_id is not null then
      select * into template from public.notification_templates where id = rule.template_id and status = 'ACTIVE' and channel = 'line-messaging';
      if found then
        rendered := public.notification_render_template(template.body, new.event_context);
        if rendered is not null then body := rendered; end if;
        rendered := public.notification_render_template(template.subject, new.event_context);
        if rendered is not null then title := rendered; end if;
      end if;
    end if;
  end if;
  insert into public.integration_outbox(integration_code,idempotency_key,event_type,target_module,payload,status,next_attempt_at,max_attempts,delivery_channel)
    values('LINE-NOTIFY-' || new.id::text,'line-notification:' || new.id::text,'LINE_NOTIFICATION','line_notifications',
      jsonb_build_object('notificationId',new.id,'recipientId',new.recipient_id,'type',new.type,
        'title',title,'body',body,'link',new.link,'policy',policy), 'PENDING', next_at, attempts, 'line-messaging')
    on conflict(idempotency_key) do nothing returning id into outbox_id;
  if rule.id is not null and rule.escalation_after_minutes is not null and outbox_id is not null then
    if rule.escalation_recipient = 'event.recipient' then escalation_target := new.recipient_id;
    elsif rule.escalation_recipient in ('supervisor','Manager') then
      select p.supervisor_id into escalation_target from public.profiles p where p.id = new.recipient_id;
    end if;
    if escalation_target is not null and exists(select 1 from public.profiles p where p.id = escalation_target and p.status = 'active') then
      insert into public.integration_outbox(integration_code,idempotency_key,event_type,target_module,payload,status,next_attempt_at,max_attempts,delivery_channel)
        values('ESCALATE-' || outbox_id::text,'line-escalation:' || outbox_id::text,'NOTIFICATION','notifications',
          jsonb_build_object('recipientId',escalation_target,'type','notification_delivery_delayed',
            'title','มีการแจ้งเตือนที่ยังส่ง LINE ไม่สำเร็จ','body','กรุณาตรวจสอบงานที่เกี่ยวข้อง โดยระบบยังตรวจสิทธิ์การเปิดข้อมูลตามปกติ',
            'link',new.link,'line',false,'dependsOnOutboxId',outbox_id),
          'PENDING', now() + make_interval(mins => rule.escalation_after_minutes), 5, 'in-app');
    end if;
  end if;
  return new;
end;
$$;

create function public.notification_line_fallback() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.event_type = 'LINE_NOTIFICATION' and new.status = 'DEAD' and old.status is distinct from 'DEAD'
    and new.payload->'policy'->>'fallbackChannel' = 'in-app' then
    insert into public.notifications(id,recipient_id,type,title,body,link,send_line)
      values(new.id,(new.payload->>'recipientId')::uuid,'notification_delivery_failed',
        'ส่ง LINE ไม่สำเร็จ',new.payload->>'title',new.payload->>'link',false)
      on conflict(id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.notification_line_fallback() from public, anon, authenticated;
create trigger trg_notification_line_fallback after update of status on public.integration_outbox
  for each row execute function public.notification_line_fallback();

-- Ordinary users may only mark their own notifications read, never rewrite policy metadata.
revoke update on public.notifications from authenticated;
grant update(is_read,read_at) on public.notifications to authenticated;
