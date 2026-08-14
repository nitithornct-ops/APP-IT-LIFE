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
  },
});
