#!/usr/bin/env node
/**
 * cleanup-users.mjs — ลบบัญชีผู้ใช้ทุกคน เหลือไว้เฉพาะผู้ที่มีบทบาท super_admin
 *
 * ทำไมต้องมีสคริปต์นี้: หน้า "จัดการผู้ใช้งาน" อ่านจาก public.profiles ซึ่งผูกกับ auth.users แบบ
 * on delete cascade — แต่มี 18 คอลัมน์ใน 14 ตารางที่อ้าง profiles(id) ด้วย on delete restrict
 * หรือ no action (ค่า default) การกดลบใน Supabase Dashboard จึงล้มทั้ง transaction พร้อมข้อความ
 * "Database error deleting user" ที่อ่านไม่รู้เรื่อง และผู้ใช้ยังค้างอยู่ในรายการเหมือนไม่มีอะไรเกิดขึ้น
 * สคริปต์นี้เคลียร์แถวที่ขวางตามลำดับให้ก่อน แล้วจึงลบบัญชี Auth ให้ cascade ทำงานได้จนจบ
 *
 * วิธีใช้:
 *   node scripts/cleanup-users.mjs                  # dry run — แสดงแผนอย่างเดียว ไม่แตะข้อมูล
 *   node scripts/cleanup-users.mjs --apply --yes    # ลบจริง (ต้องใส่ทั้งสองแฟล็ก)
 *   node scripts/cleanup-users.mjs --keep=a@b.com,c@d.com   # เก็บอีเมลเพิ่มนอกเหนือจาก super_admin
 *   node scripts/cleanup-users.mjs --keep-role=super_admin,it_admin   # เปลี่ยนบทบาทที่จะเก็บไว้
 *
 * ต้องตั้งค่า SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (อ่านจาก apps/api/.dev.vars อัตโนมัติถ้ามีไฟล์)
 *
 * ก่อนลบจริง สคริปต์จะ dump ทุกแถวที่กำลังจะหายลง backups/user-cleanup-<timestamp>.json เสมอ
 * (โฟลเดอร์ backups/ ถูก gitignore ไว้แล้ว) — เป็นตาข่ายรองชั้นเดียวที่มี เพราะ workflow Backup
 * ของโปรเจกต์นี้ยังไม่เคยรัน จึงไม่มี restore point อื่นให้ย้อนกลับ
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

/** คอลัมน์ที่ขวางการลบแต่ nullable — เคลียร์ค่าเป็น NULL ได้ ไม่ต้องลบทั้งแถว */
const NULLABLE_BLOCKERS = [
  ['change_requests', 'test_signoff_by'],
  ['change_requests', 'approver_id'],
  ['change_requests', 'deploy_by'],
  ['ticket_rating_criteria', 'created_by'],
  ['ticket_rating_criteria', 'updated_by'],
  ['tickets', 'signature_uploaded_by'],
  ['tickets', 'requester_signature_uploaded_by'],
];

/**
 * คอลัมน์ที่ขวางการลบและเป็น NOT NULL — ต้องลบทั้งแถวทิ้ง เพราะแถวเหล่านี้ "เป็นของ" ผู้ใช้ที่จะลบ
 * เรียงลูกไว้ก่อนพ่อแม่เท่าที่ทราบ ส่วนที่เหลือใช้การวนซ้ำหลายรอบช่วยแก้ลำดับให้เอง
 */
const ROW_BLOCKERS = [
  ['workflow_approvals', 'approver_id'],
  ['workflow_approvals', 'original_approver_id'],
  ['workflow_instances', 'requester_id'],
  ['access_requests', 'approver_id'],
  ['change_requests', 'requester_id'],
  ['incidents', 'reported_by'],
  ['issue_forms', 'created_by'],
  ['knowledge_articles', 'author_id'],
  ['log_reviews', 'reviewer_id'],
  ['logging_systems', 'responsible_id'],
  ['policy_acknowledgements', 'acknowledger_id'],
  ['recovery_tests', 'tester_id'],
  ['backup_logs', 'operator_id'],
  ['bcp_plans', 'owner_id'],
  ['vulnerability_findings', 'owner_id'],
];

function loadDevVars(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=');
        return [line.slice(0, idx), line.slice(idx + 1)];
      }),
  );
}

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const withValue = /^--([^=]+)=(.*)$/.exec(raw);
    if (withValue) args[withValue[1]] = withValue[2];
    else if (raw.startsWith('--')) args[raw.slice(2)] = true;
  }
  return args;
}

function list(value) {
  return String(value ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.apply === true && args.yes === true;
  const keepRoles = args['keep-role'] ? list(args['keep-role']) : ['super_admin'];
  const keepEmails = new Set(list(args.keep));

  if (args.apply === true && args.yes !== true) {
    console.error('ต้องใส่ --yes ควบคู่กับ --apply เพื่อยืนยันการลบจริง — ยกเลิก');
    process.exit(1);
  }

  const devVars = loadDevVars(new URL('../apps/api/.dev.vars', import.meta.url));
  const SUPABASE_URL = process.env.SUPABASE_URL ?? devVars.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? devVars.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ไม่พบ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — ตั้งค่าใน apps/api/.dev.vars หรือ environment variable ก่อนรัน');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`โปรเจกต์: ${SUPABASE_URL}`);
  console.log(`โหมด: ${apply ? '*** ลบจริง (APPLY) ***' : 'dry run — ไม่แตะข้อมูล'}`);
  console.log(`บทบาทที่เก็บไว้: ${keepRoles.join(', ')}${keepEmails.size ? ` + อีเมล ${[...keepEmails].join(', ')}` : ''}\n`);

  // ------------------------------------------------------------------ สำรวจ
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, employee_code, full_name, email, phone, status, created_at')
    .order('created_at', { ascending: false })
    .range(0, 999);
  if (profilesError) throw profilesError;

  const { data: assignments, error: assignmentsError } = await supabase
    .from('user_roles')
    .select('user_id, roles(key)');
  if (assignmentsError) throw assignmentsError;

  const rolesByUser = new Map();
  for (const row of assignments) {
    const key = row.roles?.key;
    if (!key) continue;
    if (!rolesByUser.has(row.user_id)) rolesByUser.set(row.user_id, []);
    rolesByUser.get(row.user_id).push(key);
  }

  const keep = [];
  const doomed = [];
  for (const profile of profiles) {
    const roles = rolesByUser.get(profile.id) ?? [];
    const protectedByRole = roles.some((key) => keepRoles.includes(key));
    const protectedByEmail = keepEmails.has(String(profile.email).toLowerCase());
    (protectedByRole || protectedByEmail ? keep : doomed).push({ ...profile, roles });
  }

  console.log(`เก็บไว้ ${keep.length} บัญชี:`);
  for (const user of keep) console.log(`  ✓ ${user.email}  (${user.full_name}) [${user.roles.join(', ') || 'ไม่มีบทบาท'}]`);
  console.log(`\nจะลบ ${doomed.length} บัญชี:`);
  for (const user of doomed) console.log(`  ✗ ${user.email}  (${user.full_name}) [${user.roles.join(', ') || 'ไม่มีบทบาท'}]`);
  console.log('');

  // ------------------------------------------------------------------ ด่านกันพลาด
  const activeSuperAdmins = keep.filter((user) => user.roles.includes('super_admin') && user.status === 'active');
  if (activeSuperAdmins.length === 0) {
    console.error('ยกเลิก: จะไม่เหลือ super_admin ที่ active เลย — last-admin guard ในฐานข้อมูลจะบล็อกอยู่ดี');
    process.exit(1);
  }
  if (doomed.length === 0) {
    console.log('ไม่มีบัญชีที่ต้องลบ — จบการทำงาน');
    return;
  }

  const doomedIds = doomed.map((user) => user.id);

  // ------------------------------------------------------------------ นับแถวที่ขวางอยู่
  console.log('แถวที่อ้างถึงบัญชีเหล่านี้ด้วย FK แบบ restrict / no action:');
  let blockingTotal = 0;
  for (const [table, column] of [...NULLABLE_BLOCKERS, ...ROW_BLOCKERS]) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).in(column, doomedIds);
    if (error) {
      console.log(`  ? ${table}.${column} — อ่านไม่ได้: ${error.message}`);
      continue;
    }
    if (count) {
      const action = NULLABLE_BLOCKERS.some(([t, c]) => t === table && c === column) ? 'ตั้งเป็น NULL' : 'ลบทั้งแถว';
      console.log(`  • ${table}.${column} = ${count} แถว → ${action}`);
      blockingTotal += count;
    }
  }
  if (blockingTotal === 0) console.log('  (ไม่มี — ลบได้ตรง ๆ)');
  console.log('');

  if (!apply) {
    console.log('นี่คือ dry run เท่านั้น ยังไม่มีอะไรถูกแก้ไข');
    console.log('รันจริงด้วย: node scripts/cleanup-users.mjs --apply --yes');
    return;
  }

  // ------------------------------------------------------------------ สำรองก่อนลบ
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshot = { takenAt: new Date().toISOString(), supabaseUrl: SUPABASE_URL, deletedProfiles: doomed, tables: {} };
  for (const [table, column] of ROW_BLOCKERS) {
    const { data, error } = await supabase.from(table).select('*').in(column, doomedIds);
    if (error) continue;
    if (data?.length) snapshot.tables[`${table}.${column}`] = data;
  }
  const { data: doomedIncidents } = await supabase.from('incidents').select('id').in('reported_by', doomedIds);
  const doomedIncidentIds = (doomedIncidents ?? []).map((row) => row.id);
  if (doomedIncidentIds.length) {
    const { data } = await supabase.from('problem_incidents').select('*').in('incident_id', doomedIncidentIds);
    if (data?.length) snapshot.tables['problem_incidents.incident_id'] = data;
  }
  mkdirSync(new URL('../backups/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../backups/user-cleanup-${stamp}.json`, import.meta.url), JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`สำรองข้อมูลที่กำลังจะลบไว้ที่ backups/user-cleanup-${stamp}.json แล้ว\n`);

  // ------------------------------------------------------------------ เคลียร์คอลัมน์ nullable
  for (const [table, column] of NULLABLE_BLOCKERS) {
    const { error } = await supabase.from(table).update({ [column]: null }).in(column, doomedIds);
    if (error) console.error(`  ! ตั้ง NULL ให้ ${table}.${column} ไม่สำเร็จ: ${error.message}`);
  }

  // problem_incidents.incident_id เป็น restrict ต้องลบก่อน incidents (ตัวเดียวในระบบที่เป็นหลานขวางอยู่)
  if (doomedIncidentIds.length) {
    const { error } = await supabase.from('problem_incidents').delete().in('incident_id', doomedIncidentIds);
    if (error) console.error(`  ! ลบ problem_incidents ไม่สำเร็จ: ${error.message}`);
  }

  // ------------------------------------------------------------------ ลบแถวที่เป็นของผู้ใช้ (วนจนกว่าจะไม่คืบหน้า)
  let pending = [...ROW_BLOCKERS];
  for (let pass = 1; pass <= 4 && pending.length; pass += 1) {
    const failed = [];
    for (const [table, column] of pending) {
      const { error } = await supabase.from(table).delete().in(column, doomedIds);
      if (error) failed.push([table, column, error.message]);
    }
    if (failed.length === pending.length) {
      console.error('\nลบแถวที่ขวางไม่สำเร็จ (ไม่คืบหน้าแล้ว):');
      for (const [table, column, message] of failed) console.error(`  ! ${table}.${column}: ${message}`);
      console.error('\nหยุดก่อนลบบัญชี Auth เพื่อไม่ให้ข้อมูลค้างครึ่ง ๆ กลาง ๆ');
      process.exit(1);
    }
    pending = failed.map(([table, column]) => [table, column]);
  }

  // ------------------------------------------------------------------ ลบบัญชี Auth (profiles cascade ตามเอง)
  console.log('กำลังลบบัญชี Auth...');
  const failures = [];
  for (const user of doomed) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      failures.push({ email: user.email, message: error.message });
      console.error(`  ✗ ${user.email}: ${error.message}`);
    } else {
      console.log(`  ✓ ${user.email}`);
    }
  }

  // ------------------------------------------------------------------ ตรวจผล
  const { data: remaining, error: remainingError } = await supabase.from('profiles').select('id, email, status').range(0, 999);
  if (remainingError) throw remainingError;
  console.log(`\nเหลือผู้ใช้ในระบบ ${remaining.length} คน: ${remaining.map((user) => user.email).join(', ')}`);

  if (failures.length) {
    console.error(`\nลบไม่สำเร็จ ${failures.length} บัญชี — ดูข้อความข้างบนว่าตารางไหนยังอ้างอยู่`);
    process.exit(1);
  }
  console.log('เรียบร้อย');
}

main().catch((error) => {
  console.error('เกิดข้อผิดพลาด:', error.message ?? error);
  process.exit(1);
});
