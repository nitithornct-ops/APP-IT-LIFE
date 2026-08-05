-- ============================================================================
-- ไฟล์นี้ใช้เฉพาะการทดสอบในเครื่อง (pglite) เท่านั้น — จำลอง auth.users/auth.uid()/
-- Postgres role ที่ Supabase โปรเจกต์จริงมีให้อยู่แล้วโดยกำเนิด
-- ห้ามนำไฟล์นี้ไป apply กับ Supabase โปรเจกต์จริงเด็ดขาด (ไม่อยู่ใน supabase/migrations/)
-- ============================================================================

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- จำลอง auth.uid() ของ Supabase จริง โดยอ่านค่าจาก session setting ที่ Test ตั้งไว้
-- (ของจริง Supabase อ่านจาก JWT claims ที่ PostgREST/Supavisor แนบมาให้ต่อ request)
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- Role จำลองให้ตรงกับ Supabase จริง: anon (ไม่ได้ login), authenticated (login แล้ว),
-- service_role (Backend ใช้ Service Role Key — bypass RLS ตามค่าเริ่มต้นของ Supabase)
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- ของจริง Supabase ให้เฉพาะ internal auth service เขียน auth.users ได้ — ในเครื่องมือทดสอบนี้
-- ให้ service_role เขียนได้แทน (จำลองการสร้างบัญชีผ่าน Supabase Auth Admin API จาก Backend)
grant select, insert, update, delete on auth.users to service_role;
grant select on auth.users to authenticated;
