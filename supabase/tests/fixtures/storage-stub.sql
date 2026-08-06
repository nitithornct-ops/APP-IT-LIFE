-- ============================================================================
-- ไฟล์นี้ใช้เฉพาะการทดสอบในเครื่อง (pglite) เท่านั้น — จำลอง storage.buckets/storage.objects/
-- storage.foldername() ที่ Supabase โปรเจกต์จริงมีให้อยู่แล้วโดยกำเนิด (Storage extension)
-- ห้ามนำไฟล์นี้ไป apply กับ Supabase โปรเจกต์จริงเด็ดขาด (ไม่อยู่ใน supabase/migrations/)
-- โครงสร้างคอลัมน์และฟังก์ชันย่อลงเหลือเท่าที่ RLS policy ของเราต้องใช้เท่านั้น
-- ============================================================================

create schema if not exists storage;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ตัวจริงของ Supabase (storage-api): ตัดส่วนหลังสุด (ชื่อไฟล์) ออก เหลือเฉพาะ path ของโฟลเดอร์
-- เช่น 'USER_ID/uuid-file.pdf' -> ARRAY['USER_ID']
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end;
$$;

alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.buckets to service_role;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.objects to anon;
