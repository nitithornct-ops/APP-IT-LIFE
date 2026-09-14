import { describe, expect, it } from 'vitest';
import { loginLogSchema, resolveLoginSchema } from '../src/validators/auth';
import { createLocalUserSchema, resetPasswordSchema, updateUserSchema } from '../src/validators/users';

const validAccount = { username: 'somchai.j', password: 'Rong2568Pass', fullName: 'สมชาย ใจดี' };

describe('local account creation', () => {
  it('stores the username in lower case so one person cannot own two spellings of it', () => {
    const parsed = createLocalUserSchema.parse({ ...validAccount, username: 'Somchai.J' });
    expect(parsed.username).toBe('somchai.j');
  });

  it('accepts the punctuation staff actually use in usernames', () => {
    for (const username of ['somchai.j', 'som_chai', 'som-chai', 'user123']) {
      expect(createLocalUserSchema.safeParse({ ...validAccount, username }).success).toBe(true);
    }
  });

  it('rejects usernames that would make an identity ambiguous or unusable', () => {
    // ช่องว่างและ @ ทำให้แยกไม่ออกว่าเป็นชื่อผู้ใช้หรืออีเมล ส่วนสั้น/ยาวเกินไปเดาชนกันง่าย
    for (const username of ['so', 'some one', 'somchai@life.co.th', 'ก'.repeat(5), 'a'.repeat(33)]) {
      expect(createLocalUserSchema.safeParse({ ...validAccount, username }).success).toBe(false);
    }
  });

  it('holds the initial password to the same policy as the vendor portal', () => {
    for (const password of ['Short1aA', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsAtAll']) {
      expect(createLocalUserSchema.safeParse({ ...validAccount, password }).success).toBe(false);
    }
    expect(createLocalUserSchema.safeParse(validAccount).success).toBe(true);
  });

  it('keeps department and position optional, because not every account has them on day one', () => {
    expect(createLocalUserSchema.safeParse(validAccount).success).toBe(true);
    expect(createLocalUserSchema.safeParse({ ...validAccount, departmentId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('admin password reset', () => {
  it('applies the same password policy as account creation', () => {
    expect(resetPasswordSchema.safeParse({ password: 'Rong2568Pass' }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ password: 'weak' }).success).toBe(false);
  });
});

describe('updating a user', () => {
  it('lets an email account be given a username later, or have it cleared', () => {
    expect(updateUserSchema.parse({ username: 'Malee.D' }).username).toBe('malee.d');
    expect(updateUserSchema.safeParse({ username: null }).success).toBe(true);
    expect(updateUserSchema.safeParse({ username: 'has space' }).success).toBe(false);
  });
});

describe('login endpoints', () => {
  /**
   * ก่อนรองรับบัญชีชื่อผู้ใช้ ช่องนี้ตรวจเป็นอีเมล ผลคือทุกครั้งที่ผู้ใช้ชื่อผู้ใช้ล็อกอินไม่ผ่าน
   * การบันทึก Login Log จะถูกปฏิเสธไปด้วย ทำให้หลักฐานความพยายามที่ล้มเหลวหายไปเงียบ ๆ
   */
  it('records a failed attempt made with a plain username, not just an email', () => {
    expect(loginLogSchema.safeParse({ identifier: 'somchai.j', success: false }).success).toBe(true);
    expect(loginLogSchema.safeParse({ identifier: 'somchai@life.co.th', success: true }).success).toBe(true);
    expect(loginLogSchema.safeParse({ identifier: '', success: false }).success).toBe(false);
  });

  it('bounds the identifier it will look up', () => {
    expect(resolveLoginSchema.safeParse({ identifier: 'somchai.j' }).success).toBe(true);
    expect(resolveLoginSchema.safeParse({ identifier: 'a'.repeat(255) }).success).toBe(false);
    expect(resolveLoginSchema.safeParse({ identifier: '   ' }).success).toBe(false);
  });
});
