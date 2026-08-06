#!/usr/bin/env node
/**
 * bootstrap-admin.mjs — สร้างบัญชี super_admin คนแรกของระบบ
 *
 * รันครั้งเดียวหลัง Deploy Supabase migrations ของ Phase 2/3 เสร็จแล้ว (สืบทอดแนวคิดจาก
 * bootstrapFirstAdmin() ของระบบเดิม) ส่งอีเมลเชิญให้เจ้าของระบบตั้งรหัสผ่านเอง — สคริปต์นี้ไม่ตั้ง
 * รหัสผ่านให้ใครทั้งสิ้น
 *
 * วิธีใช้:
 *   node scripts/bootstrap-admin.mjs --email=admin@company.com --name="ชื่อผู้ดูแลระบบ"
 *
 * ต้องตั้งค่าตัวแปรแวดล้อมก่อนรัน (อ่านจาก apps/api/.dev.vars อัตโนมัติถ้ามีไฟล์นี้):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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
    const match = /^--([^=]+)=(.*)$/.exec(raw);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  const fullName = args.name ?? email;

  if (!email) {
    console.error('ใช้งาน: node scripts/bootstrap-admin.mjs --email=admin@company.com --name="ชื่อผู้ดูแลระบบ"');
    process.exit(1);
  }

  const devVars = loadDevVars(new URL('../apps/api/.dev.vars', import.meta.url));
  const SUPABASE_URL = process.env.SUPABASE_URL ?? devVars.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? devVars.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ไม่พบ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — ตั้งค่าใน apps/api/.dev.vars หรือ environment variable ก่อนรัน');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log(`กำลังเชิญผู้ใช้ ${email} เป็น super_admin...`);

  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });

  let userId = invited?.user?.id;

  if (inviteError) {
    if (inviteError.message?.toLowerCase().includes('already been registered')) {
      console.log('อีเมลนี้มีบัญชีอยู่แล้ว — จะมอบบทบาท super_admin ให้บัญชีเดิม');
      const { data: existing, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) {
        console.error('ค้นหาบัญชีเดิมไม่สำเร็จ:', listError.message);
        process.exit(1);
      }
      const found = existing.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!found) {
        console.error('ไม่พบบัญชีที่ตรงกับอีเมลนี้');
        process.exit(1);
      }
      userId = found.id;
    } else {
      console.error('เชิญผู้ใช้ไม่สำเร็จ:', inviteError.message);
      process.exit(1);
    }
  }

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('id')
    .eq('key', 'super_admin')
    .single();

  if (roleError || !role) {
    console.error('ไม่พบบทบาท super_admin ในฐานข้อมูล — ตรวจสอบว่ารัน supabase/seed.sql แล้วหรือยัง');
    process.exit(1);
  }

  const { error: assignError } = await supabase
    .from('user_roles')
    .upsert({ user_id: userId, role_id: role.id }, { onConflict: 'user_id,role_id', ignoreDuplicates: true });

  if (assignError) {
    console.error('มอบบทบาท super_admin ไม่สำเร็จ:', assignError.message);
    process.exit(1);
  }

  console.log(`สำเร็จ — ${email} เป็น super_admin แล้ว ระบบได้ส่งอีเมลเชิญให้ตั้งรหัสผ่านเอง (ถ้าเป็นบัญชีใหม่)`);
}

main().catch((err) => {
  console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', err);
  process.exit(1);
});
