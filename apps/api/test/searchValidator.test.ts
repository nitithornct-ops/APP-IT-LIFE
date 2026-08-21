import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from '../src/validators/search';
import { cleanSearch } from '../src/utils/search';

describe('searchQuerySchema', () => {
  it('รับคำค้นตั้งแต่ 2 ตัวอักษรขึ้นไป', () => {
    expect(searchQuerySchema.safeParse({ q: 'TC' }).success).toBe(true);
    expect(searchQuerySchema.safeParse({ q: 'โน้ตบุ๊ก' }).success).toBe(true);
  });

  it('ปฏิเสธคำค้นที่สั้นเกินกว่าจะช่วยอะไร แต่ยังกินต้นทุนฐานข้อมูลเต็ม ๆ', () => {
    expect(searchQuerySchema.safeParse({ q: 'T' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: '  ' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
  });

  it('จำกัดความยาว ไม่ให้ยิงคำค้นขนาดใหญ่เข้าไปในทุกตาราง', () => {
    expect(searchQuerySchema.safeParse({ q: 'ก'.repeat(101) }).success).toBe(false);
  });

  it('คำค้นที่ผ่าน validator แล้วอาจเหลือว่างหลัง cleanSearch — route ต้องกันเอง', () => {
    const parsed = searchQuerySchema.safeParse({ q: '%%' });
    expect(parsed.success).toBe(true);
    expect(cleanSearch(parsed.success ? parsed.data.q : '')).toBe('');
  });
});
