import { describe, expect, it } from 'vitest';
import { verifyFileSignature } from '../src/utils/fileSignature';

/**
 * การอัปโหลดเคยเชื่อ `file.type` ที่ Client ส่งมาเพียงอย่างเดียว ผู้ใช้ที่ล็อกอินแล้วจึงเก็บไฟล์ชนิดใด
 * ก็ได้ลง Storage ขององค์กรเพียงประกาศชนิดปลอมมา และ mime_type ที่บันทึกไว้ก็เป็นค่าที่เชื่อไม่ได้
 * (พบตอน Pre-production QA audit 2026-08-13)
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

function makeFile(content: Uint8Array, name: string, declaredType: string): File {
  return new File([content], name, { type: declaredType });
}

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46);
const GIF = text('GIF89a....');
const PDF = text('%PDF-1.7\n%âãÏÓ');
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00);
const OLE = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00);
const WEBP = new Uint8Array([...text('RIFF'), 0x24, 0x00, 0x00, 0x00, ...text('WEBPVP8 ')]);

describe('verifyFileSignature accepts genuine files', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['GIF', GIF, 'image/gif'],
    ['WebP', WEBP, 'image/webp'],
    ['PDF', PDF, 'application/pdf'],
    ['plain text', text('รายงานประจำเดือน\nบรรทัดที่สอง'), 'text/plain'],
  ])('accepts a real %s', async (_label, content, mime) => {
    const result = await verifyFileSignature(makeFile(content, `file`, mime), mime);
    expect(result.ok).toBe(true);
    expect(result.resolvedMime).toBe(mime);
  });

  /**
   * อักษรไทยใช้ 3 ไบต์ต่อตัวใน UTF-8 และตัวตรวจอ่านมาเพียงหัวไฟล์ ความยาวที่ทำให้ขอบการอ่าน
   * ตกกลางตัวอักษรพอดีต้องยังผ่าน — เคสนี้หลุดจากเทสต์ชุดแรกเพราะข้อความที่ใช้บังเอิญตัดพอดีขอบ
   * แล้วไปโผล่ตอนทดสอบอัปโหลดจริง
   */
  it.each([20, 21, 22, 23, 24, 25, 40, 200])('accepts a Thai text file of %i characters', async (length) => {
    const content = text('ก'.repeat(length));
    const result = await verifyFileSignature(makeFile(content, 'report.txt', 'text/plain'), 'text/plain');
    expect(result.ok, `ข้อความไทย ${length} ตัว (${content.length} ไบต์) ต้องผ่าน`).toBe(true);
  });

  it('accepts a docx because its bytes are a ZIP container', async () => {
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const result = await verifyFileSignature(makeFile(ZIP, 'report.docx', mime), mime);
    expect(result.ok).toBe(true);
    expect(result.resolvedMime).toBe(mime);
  });

  it('accepts a legacy .xls because its bytes are an OLE2 container', async () => {
    const mime = 'application/vnd.ms-excel';
    const result = await verifyFileSignature(makeFile(OLE, 'book.xls', mime), mime);
    expect(result.ok).toBe(true);
  });
});

describe('verifyFileSignature rejects a forged content type', () => {
  it('rejects an executable renamed and declared as a PNG', async () => {
    const exe = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00);
    const result = await verifyFileSignature(makeFile(exe, 'photo.png', 'image/png'), 'image/png');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ไม่ตรงกับชนิดไฟล์');
  });

  it('rejects a PDF declared as a JPEG', async () => {
    const result = await verifyFileSignature(makeFile(PDF, 'scan.jpg', 'image/jpeg'), 'image/jpeg');
    expect(result.ok).toBe(false);
  });

  it('rejects a ZIP declared as a legacy .doc', async () => {
    const result = await verifyFileSignature(makeFile(ZIP, 'memo.doc', 'application/msword'), 'application/msword');
    expect(result.ok).toBe(false);
  });

  it('rejects binary content declared as plain text', async () => {
    const result = await verifyFileSignature(makeFile(bytes(0x00, 0x01, 0x02, 0xff), 'notes.txt', 'text/plain'), 'text/plain');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty file', async () => {
    const result = await verifyFileSignature(makeFile(new Uint8Array(), 'empty.png', 'image/png'), 'image/png');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ว่างเปล่า');
  });
});

describe('verifyFileSignature rejects browser-executable content outright', () => {
  it.each([
    ['HTML document', '<!DOCTYPE html><html><body>hi</body></html>'],
    ['bare html tag', '<html><script>alert(1)</script></html>'],
    ['script tag', '<script>fetch("https://evil.example")</script>'],
    ['SVG with script', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['PHP source', '<?php system($_GET["c"]); ?>'],
  ])('rejects %s even when declared as text/plain', async (_label, payload) => {
    const result = await verifyFileSignature(makeFile(text(payload), 'note.txt', 'text/plain'), 'text/plain');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('สคริปต์');
  });

  it('rejects an SVG payload declared as a PNG', async () => {
    const payload = text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = await verifyFileSignature(makeFile(payload, 'logo.png', 'image/png'), 'image/png');
    expect(result.ok).toBe(false);
  });
});
