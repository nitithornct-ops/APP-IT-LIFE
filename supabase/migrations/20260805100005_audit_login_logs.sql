-- ============================================================================
-- audit_logs, login_logs — ห้ามผู้ใช้งานทั่วไปแก้ไขหรือลบ (immutable)
-- Legacy: audit_logs สืบทอดจาก Sheet AuditTrail เดิม (LogID, ActorEmail, Action, Module,
-- TargetSheet, TargetID, Detail, Result) — login_logs เป็นตารางใหม่ตามสเปก (ระบบเดิมปนไว้
-- ใน AuditTrail ด้วย Action='LOGIN' ไม่ได้แยกตาราง)
-- เขียนได้ทางเดียวคือผ่าน service_role จาก Cloudflare Workers เท่านั้น (ไม่มี insert policy
-- ให้ authenticated/anon) — service_role bypass RLS ตามค่าเริ่มต้นของ Supabase
-- ============================================================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  actor_role text,
  action text not null,
  module text not null,
  target_table text,
  target_id text,
  detail jsonb,
  result text not null default 'success' check (result in ('success', 'fail', 'denied')),
  request_id text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_logs_actor_id_idx on public.audit_logs (actor_id);
create index audit_logs_module_idx on public.audit_logs (module);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;

create policy audit_logs_select_with_permission on public.audit_logs
  for select to authenticated
  using (public.has_permission('audit.view'));

-- ไม่มี insert/update/delete policy ให้ authenticated โดยตั้งใจ — เขียนผ่าน service_role เท่านั้น

create table public.login_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  email_attempted text not null,
  success boolean not null,
  failure_reason text,
  mfa_used boolean not null default false,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index login_logs_user_id_idx on public.login_logs (user_id);
create index login_logs_created_at_idx on public.login_logs (created_at desc);

alter table public.login_logs enable row level security;

create policy login_logs_select_with_permission on public.login_logs
  for select to authenticated
  using (public.has_permission('audit.view'));

-- ไม่มี insert/update/delete policy ให้ authenticated โดยตั้งใจ — เขียนผ่าน service_role เท่านั้น
