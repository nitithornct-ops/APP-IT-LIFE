import { createClient } from '@supabase/supabase-js';

/**
 * Client เดียวที่ใช้ทั้งแอปสำหรับ Supabase Auth เท่านั้น (Login/Logout/Session/Forgot Password)
 * ข้อมูลของระบบทั้งหมดต้องเรียกผ่าน Cloudflare Workers API (services/apiClient.ts) ไม่ใช่ผ่าน client นี้โดยตรง
 */
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Do not leave the staff JWT behind after the browser tab/session is closed.
    storage: typeof window === 'undefined' ? undefined : window.sessionStorage,
  },
});
