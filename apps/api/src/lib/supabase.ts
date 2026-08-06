import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';

/**
 * Client ที่ผูกกับ JWT ของผู้ใช้ปัจจุบัน — ใช้เรียกทุก query ปกติเพื่อให้ RLS ทำงานจริง
 * (ตามสเปก "API ทั่วไปควรส่ง JWT ของผู้ใช้ไปยัง Supabase เพื่อให้ RLS ทำงาน")
 */
export function createUserScopedClient(env: Bindings, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client สิทธิ์ Service Role — ใช้เฉพาะฟังก์ชัน Admin ที่ตรวจสิทธิ์แล้วเท่านั้น (bypass RLS)
 * เช่น สร้างบัญชีผู้ใช้ผ่าน Auth Admin API และการเขียน audit_logs/login_logs ที่ผู้ใช้ทั่วไปเขียนตรงไม่ได้
 * ห้ามส่ง client นี้ออกไปให้ route handler ทั่วไปใช้พร่ำเพรื่อ — ต้องผ่าน requirePermission ก่อนเสมอ
 */
export function createAdminClient(env: Bindings): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
