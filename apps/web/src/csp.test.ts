import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * index.html โหลดฟอนต์ Sarabun จาก Google Fonts แต่ CSP ใน public/_headers เคยอนุญาตแค่ 'self'
 * ผลคือเบราว์เซอร์บล็อกทั้ง stylesheet และไฟล์ฟอนต์เงียบ ๆ ระบบตกไปใช้ฟอนต์ระบบแทนโดยไม่มีใครรู้
 * (พบตอน Pre-production QA audit 2026-08-13) — build ผ่าน typecheck ผ่าน แต่หน้าจอผิดจากที่ออกแบบ
 *
 * เทสต์นี้จับคู่ "สิ่งที่ index.html ขอโหลด" กับ "สิ่งที่ CSP ยอม" เพื่อไม่ให้หลุดแบบเดิมอีก
 */

const webRoot = resolve(__dirname, '..');
const indexHtml = readFileSync(resolve(webRoot, 'index.html'), 'utf8');
const headers = readFileSync(resolve(webRoot, 'public/_headers'), 'utf8');

const cspLine = headers.split(/\r?\n/).find((line) => line.includes('Content-Security-Policy:'));

/** อ่านรายการ source ของ directive หนึ่งออกมาจากสตริง CSP */
function directive(name: string): string[] {
  const csp = cspLine?.split('Content-Security-Policy:')[1] ?? '';
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found ? found.split(/\s+/).slice(1) : [];
}

/**
 * origin ของทุก <link rel="stylesheet"> ที่ชี้ออกนอกโดเมนตัวเอง
 * จับทั้ง tag ก่อนแล้วค่อยอ่าน attribute เพราะ href กับ rel สลับลำดับกันได้และขึ้นบรรทัดใหม่ได้
 */
function externalStylesheetOrigins(): string[] {
  return [...indexHtml.matchAll(/<link\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /rel\s*=\s*"stylesheet"/.test(tag))
    .map((tag) => /href\s*=\s*"(https:\/\/[^"]+)"/.exec(tag)?.[1])
    .filter((href): href is string => Boolean(href))
    .map((href) => new URL(href).origin);
}

describe('Content-Security-Policy', () => {
  it('is declared for every path', () => {
    expect(cspLine).toBeDefined();
    expect(headers.split(/\r?\n/)[0].trim()).toBe('/*');
  });

  it('allows every external stylesheet index.html links to', () => {
    const stylesheets = externalStylesheetOrigins();
    // กันเทสต์ผ่านแบบว่างเปล่า: ถ้า index.html ยังอ้าง Google Fonts อยู่ ต้องจับได้อย่างน้อยหนึ่งรายการ
    if (indexHtml.includes('fonts.googleapis.com')) {
      expect(stylesheets.length).toBeGreaterThan(0);
    }
    const allowed = directive('style-src');
    for (const origin of stylesheets) {
      expect(allowed, `style-src ต้องอนุญาต ${origin}`).toContain(origin);
    }
  });

  it('allows the font host that the linked stylesheet fetches from', () => {
    // Google Fonts ส่ง CSS จาก fonts.googleapis.com แต่ตัวไฟล์ฟอนต์อยู่ที่ fonts.gstatic.com
    // ถ้าอนุญาตแค่โดเมนแรก stylesheet จะโหลดได้แต่ฟอนต์ยังถูกบล็อกอยู่ดี
    if (indexHtml.includes('fonts.googleapis.com')) {
      expect(directive('font-src')).toContain('https://fonts.gstatic.com');
    }
  });

  it('still refuses scripts and objects from anywhere but this origin', () => {
    expect(directive('script-src')).toEqual(["'self'"]);
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'self'"]);
  });

  it('never widens style-src or font-src to a wildcard', () => {
    for (const name of ['style-src', 'font-src']) {
      expect(directive(name)).not.toContain('*');
      expect(directive(name)).not.toContain('https:');
    }
  });
});
