-- Fan out every in-app notification to a durable LINE delivery job. Keeping this at the
-- database boundary covers notifications inserted by API routes and security-definer RPCs alike.

alter table public.notifications
  add column send_line boolean not null default true;

comment on column public.notifications.send_line is
  'When true, enqueue one durable LINE companion delivery after insert. False prevents a duplicate when a caller sends a richer LINE message itself.';

create or replace function public.enqueue_line_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.integration_outbox (
    integration_code,
    idempotency_key,
    event_type,
    target_module,
    payload,
    status,
    next_attempt_at
  ) values (
    'LINE-NOTIFY-' || new.id::text,
    'line-notification:' || new.id::text,
    'LINE_NOTIFICATION',
    'line_notifications',
    jsonb_build_object(
      'notificationId', new.id,
      'recipientId', new.recipient_id,
      'type', new.type,
      'title', new.title,
      'body', new.body,
      'link', new.link
    ),
    'PENDING',
    now()
  ) on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_line_notification() from public, anon, authenticated;

drop trigger if exists trg_notifications_enqueue_line on public.notifications;
create trigger trg_notifications_enqueue_line
  after insert on public.notifications
  for each row
  when (new.send_line)
  execute function public.enqueue_line_notification();
