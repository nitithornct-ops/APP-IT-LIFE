-- ============================================================================
-- หลักฐานการตรวจสุขภาพระบบต้องมาจากการตรวจจริง (พบจาก Pre-production QA/Security audit 2026-08-13)
--
-- ปุ่ม "health-check" ในโมดูล Governance เคยเขียนแถวลงตาราง governance_operational_checks ด้วยค่า
-- status = 'PASS' และ detail = {"database":"reachable","rls":"enabled"} แบบตายตัว โดยไม่ได้ตรวจสิ่งใด
-- เลยแม้แต่อย่างเดียว ผลคือระบบผลิต "หลักฐานการควบคุม" ที่เป็นเท็จให้ผู้ตรวจสอบภายนอกใช้อ้างอิง
--
-- ฟังก์ชันนี้อ่านสถานะจริงจาก catalog ของ PostgreSQL เพื่อให้ผลการตรวจอ้างอิงได้
-- ต้องเป็น SECURITY DEFINER เพราะ pg_catalog ไม่ได้เปิดให้ role authenticated อ่านผ่าน PostgREST
-- และจำกัดสิทธิ์เรียกไว้ที่ผู้ที่มี operations.manage เท่านั้น
-- ============================================================================

create or replace function public.governance_health_snapshot()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
declare
  total_tables integer;
  rls_enabled integer;
  unprotected text[];
  policy_count integer;
  required_settings integer;
begin
  if not public.has_permission('operations.manage') then
    raise exception 'ไม่มีสิทธิ์เรียกใช้การตรวจสุขภาพระบบ' using errcode = '42501';
  end if;

  select count(*)::int
    into total_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r';

  select count(*)::int
    into rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;

  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  select count(*)::int into policy_count from pg_policies where schemaname = 'public';

  select count(*)::int
    into required_settings
    from public.system_settings
   where key in ('ORG_NAME', 'ORG_LOGO_URL', 'SLA_BUSINESS_START', 'SLA_BUSINESS_END');

  return jsonb_build_object(
    'checkedAt', now(),
    'database', jsonb_build_object('reachable', true, 'serverTime', now()),
    'rls', jsonb_build_object(
      'totalTables', total_tables,
      'enabledTables', rls_enabled,
      'unprotectedTables', to_jsonb(unprotected),
      'policyCount', policy_count
    ),
    'settings', jsonb_build_object('requiredPresent', required_settings, 'requiredExpected', 4)
  );
end;
$$;

comment on function public.governance_health_snapshot() is
  'อ่านสถานะจริงของฐานข้อมูล (จำนวนตาราง, RLS, policy, ค่าตั้งค่าที่จำเป็น) เพื่อใช้เป็นหลักฐาน '
  'การตรวจสุขภาพระบบใน governance_operational_checks — ห้ามบันทึกผล PASS โดยไม่เรียกฟังก์ชันนี้';

revoke all on function public.governance_health_snapshot() from public, anon;
grant execute on function public.governance_health_snapshot() to authenticated;
