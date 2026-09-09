#!/usr/bin/env node
/**
 * create-admin-user.mjs — สร้างบัญชีผู้ดูแลระบบเพิ่ม พร้อมตั้งรหัสผ่านให้ทันที
 *
 * ต่างจาก bootstrap-admin.mjs ตรงที่สคริปต์นี้ "ตั้งรหัสผ่านให้เลย" และยืนยันอีเมลให้อัตโนมัติ
 * (email_confirm) จึงล็อกอินได้ทันทีโดยไม่ต้องรออีเมลเชิญ เหมาะกับบัญชีผู้ดูแลสำรองที่เจ้าของระบบ
 * ต้องการเปิดใช้เองภายในองค์กร
 *
 * MFA: สคริปต์นี้ "ไม่" ปิด MFA ให้ เพราะนโยบายถูกบังคับด้วยโค้ดที่ apps/api/src/services/mfaPolicy.ts
 * — บทบาท super_admin / it_admin ต้องยืนยันตัวตนสองขั้นตอนเสมอ บัญชีที่สร้างจากสคริปต์นี้จึงต้อง
 * สแกน QR ผูก Authenticator ครั้งแรกที่หน้า /mfa หนึ่งครั้ง หลังจากนั้นจึงใช้งานได้ตามปกติ
 *
 * วิธีใช้:
 *   node scripts/create-admin-user.mjs --email=admin2@company.com --name="ผู้ดูแลระบบสำรอง"
 *   node scripts/create-admin-user.mjs --email=admin2@company.com --password='รหัสผ่าน' --role=super_admin
 *
 * ถ้ามีบัญชีอีเมลนี้อยู่แล้ว สคริปต์จะตั้งรหัสผ่านใหม่ทับและมอบบทบาทให้ (idempotent รันซ้ำได้)
 *
 * ต้องตั้งค่า SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (อ่านจาก apps/api/.dev.vars อัตโนมัติถ้ามีไฟล์)
 */
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_PASSWORD = '12345678';
const DEFAULT_ROLE = 'it_admin';

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
    else if (raw.startsWith('--')) args[raw.slice(2)] = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  const password = args.password ?? DEFAULT_PASSWORD;
  const fullName = args.name ?? email;
  const roleKey = args.role ?? DEFAULT_ROLE;

  if (!email) {
    console.error('ใช้งาน: node scripts/create-admin-user.mjs --email=admin2@company.com --name="ชื่อผู้ดูแล" [--password=...] [--role=it_admin]');
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
  console.log(`กำลังสร้างบัญชี ${email} เป็น ${roleKey}...`);

  // ------------------------------------------------------------------ ตรวจบทบาทก่อน เพื่อไม่ให้สร้างบัญชีค้างไว้เปล่า ๆ
  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('id, name_th')
    .eq('key', roleKey)
    .maybeSingle();

  if (roleError || !role) {
    console.error(`ไม่พบบทบาท ${roleKey} ในฐานข้อมูล — ตรวจสอบว่ารัน supabase/seed.sql แล้วหรือยัง`);
    process.exit(1);
  }

  // ------------------------------------------------------------------ สร้างบัญชี Auth (trigger handle_new_user จะสร้างแถว profiles ให้เอง)
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  let userId = created?.user?.id;

  if (createError) {
    const message = createError.message?.toLowerCase() ?? '';
    if (!message.includes('already been registered') && !message.includes('already registered')) {
      console.error('สร้างบัญชีไม่สำเร็จ:', createError.message);
      process.exit(1);
    }

    console.log('อีเมลนี้มีบัญชีอยู่แล้ว — จะตั้งรหัสผ่านใหม่ทับและมอบบทบาทให้บัญชีเดิม');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    if (profileError || !profile) {
      console.error('ค้นหาบัญชีเดิมไม่สำเร็จ — ตรวจสอบอีเมลอีกครั้ง');
      process.exit(1);
    }

    userId = profile.id;
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updateError) {
      console.error('ตั้งรหัสผ่านใหม่ไม่สำเร็จ:', updateError.message);
      process.exit(1);
    }
  }

  // ------------------------------------------------------------------ มอบบทบาท
  const { error: assignError } = await supabase
    .from('user_roles')
    .upsert({ user_id: userId, role_id: role.id }, { onConflict: 'user_id,role_id', ignoreDuplicates: true });

  if (assignError) {
    console.error('มอบบทบาทไม่สำเร็จ:', assignError.message);
    process.exit(1);
  }

  // ------------------------------------------------------------------ ให้แน่ใจว่า profile ใช้งานได้จริง
  const { error: profileUpdateError } = await supabase
    .from('profiles')
    .update({ full_name: fullName, status: 'active' })
    .eq('id', userId);

  if (profileUpdateError) {
    console.error(`เตือน: อัปเดตชื่อ/สถานะใน profiles ไม่สำเร็จ (${profileUpdateError.message}) — แก้ได้ภายหลังที่หน้าจัดการผู้ใช้งาน`);
  }

  console.log('');
  console.log('สำเร็จ');
  console.log(`  อีเมล    : ${email}`);
  console.log(`  รหัสผ่าน : ${password}`);
  console.log(`  บทบาท    : ${roleKey} (${role.name_th})`);
  console.log(`  user id  : ${userId}`);
  console.log('');
  console.log('หมายเหตุ: นโยบายของระบบบังคับ MFA กับบทบาทผู้ดูแลเสมอ (apps/api/src/services/mfaPolicy.ts)');
  console.log('ครั้งแรกที่ล็อกอิน ระบบจะพาไปหน้า /mfa เพื่อสแกน QR ผูก Authenticator หนึ่งครั้ง');
}

main().catch((error) => {
  console.error('เกิดข้อผิดพลาดที่ไม่คาดคิด:', error.message ?? error);
  process.exit(1);
});
