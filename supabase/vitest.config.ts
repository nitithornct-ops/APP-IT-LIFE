import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    /**
     * ทุกไฟล์เทสต์สร้าง PGlite ของตัวเองแล้วรัน migration ทั้งชุดใน beforeAll ซึ่งกินเวลาหลายสิบวินาที
     * เมื่อ 17 ไฟล์แย่ง CPU กัน เพดาน 30 วินาทีจึงไม่พอ แล้วเทสต์ 181 ตัว (รวม RLS 135 ตัว) จะถูก
     * ข้ามไปทั้งชุด — ผลที่ได้กลายเป็นสัญญาณรบกวนที่ทำให้แยกไม่ออกว่าอะไรพังจริง
     */
    hookTimeout: 180000,
  },
});
