import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * แยก dependency ที่แทบไม่เปลี่ยนออกจากโค้ดของแอป
         *
         * เดิม bundle ก้อนหลักอยู่ที่ 764 kB (gzip 210 kB) เกินเกณฑ์เตือน 500 kB ของ Vite
         * และเพราะรวมทุกอย่างไว้ก้อนเดียว การแก้โค้ดแอปเพียงบรรทัดเดียวก็ทำให้ผู้ใช้ต้องดาวน์โหลด
         * React/Supabase ใหม่ทั้งหมด ทั้งที่ไลบรารีเหล่านั้นไม่ได้เปลี่ยน
         * (พบตอน Pre-production QA audit 2026-08-13)
         */
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'vendor-icons': ['lucide-react'],
          'vendor-date': ['date-fns'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    css: true,
    exclude: ['**/node_modules/**', '**/dist/**', './e2e/**'],
    /**
     * ค่าหลอกสำหรับเทสต์เท่านั้น — ไม่ใช่ความลับ และไม่ชี้ไปยังระบบจริงใด ๆ
     *
     * lib/supabase.ts เรียก createClient() ตั้งแต่ระดับ module ซึ่งจะโยน "supabaseUrl is required"
     * ทันทีที่ค่าว่าง เทสต์ที่ import หน้าจอใด ๆ ที่ใช้ apiClient จึงพังตั้งแต่ตอนโหลดไฟล์
     * เดิมมันผ่านบนเครื่องนักพัฒนาเพราะบังเอิญมี apps/web/.env.local อยู่ แต่ไฟล์นั้นถูก gitignore
     * เทสต์ชุดเดียวกันจึงล้มบน CI ที่ checkout มาสะอาด ๆ (พบตอนเปิด PR ก่อน go-live 2026-08-14)
     *
     * ตรึงค่าไว้ที่นี่เพื่อให้เทสต์ให้ผลเหมือนกันทุกเครื่อง และกันไม่ให้ unit test เผลอยิงไปยัง
     * Supabase จริงของใครก็ตามที่ตั้ง .env.local ไว้
     */
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key-not-a-real-credential',
      VITE_API_BASE_URL: 'http://localhost:8787',
      VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    },
  },
});
