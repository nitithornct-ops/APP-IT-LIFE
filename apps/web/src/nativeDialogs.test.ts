import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ข้อกำหนดของระบบ: ห้ามใช้ Browser Native Dialog (alert / confirm / prompt)
 *
 * WordLikeEditor เคยเรียก window.prompt() สองจุดสำหรับแทรกลิงก์และแทรกตัวแปรฟิลด์ — หน้าตาไม่เข้ากับ
 * ระบบ ปรับแต่งข้อความไม่ได้ บางเบราว์เซอร์กดปิดทั้งแท็บได้ และเขียนเทสต์อัตโนมัติครอบไม่ได้
 * (พบตอน Pre-production QA audit 2026-08-13) — ระบบมี Modal/ConfirmModal ของตัวเองอยู่แล้ว
 */

const srcRoot = resolve(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/** ตัดคอมเมนต์ออกก่อนตรวจ เพราะคอมเมนต์ที่อธิบายบั๊กเดิมย่อมเอ่ยชื่อฟังก์ชันเหล่านี้ */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no browser native dialogs', () => {
  // ตรวจเฉพาะโค้ดที่ถูกส่งขึ้น production — ไฟล์เทสต์มีสตริงตัวอย่าง XSS อย่าง onclick="alert(1)"
  // ซึ่งเป็นข้อมูลทดสอบ ไม่ใช่การเรียกใช้จริง
  const files = sourceFiles(srcRoot).filter((file) => !/\.test\.tsx?$/.test(file));

  it('scans the whole source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(['alert', 'confirm', 'prompt'])('never calls window.%s()', (name) => {
    const pattern = new RegExp(String.raw`(^|[^.\w])(window\s*\.\s*)?${name}\s*\(`, 'm');
    const offenders = files
      .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(srcRoot, file));

    expect(offenders, `ใช้ ${name}() ที่: ${offenders.join(', ')} — ให้ใช้ Modal/ConfirmModal ของระบบแทน`).toEqual([]);
  });
});
