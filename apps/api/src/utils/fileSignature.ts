/**
 * ตรวจชนิดไฟล์จาก "เนื้อไฟล์จริง" ไม่ใช่จากที่ผู้เรียกประกาศมา
 *
 * เดิมการอัปโหลดตรวจแค่ `file.type` ซึ่งเป็นค่าที่ Client ใส่มาเองใน multipart header ปลอมได้ทันที
 * ผลคือ allowlist ชนิดไฟล์ไม่มีผลจริง และคอลัมน์ mime_type ใน file_attachments เก็บค่าที่เชื่อไม่ได้
 * ทั้งยังถูกใช้เป็น Content-Type ตอนสร้าง Signed URL ให้ดาวน์โหลดอีกต่อหนึ่ง
 * (พบตอน Pre-production QA audit 2026-08-13)
 */

/** อ่านหัวไฟล์พอสำหรับดูลายเซ็น — ยาวสุดที่ต้องใช้คือ WebP ที่ต้องดูถึง byte ที่ 12 */
const HEADER_BYTES = 64;

interface Signature {
  mime: string;
  /** ลำดับไบต์ที่ต้องตรงจากตำแหน่ง offset */
  magic: number[];
  offset?: number;
  /** เงื่อนไขเพิ่มเติมสำหรับรูปแบบที่ลายเซ็นต้นไฟล์ไม่พอ (เช่น RIFF ที่ใช้ได้หลายฟอร์แมต) */
  extra?: (bytes: Uint8Array) => boolean;
}

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

const SIGNATURES: Signature[] = [
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', magic: ascii('GIF87a') },
  { mime: 'image/gif', magic: ascii('GIF89a') },
  // WebP = RIFF container ที่มีคำว่า WEBP อยู่ที่ byte 8-11 (byte 4-7 คือขนาดไฟล์ จึงข้ามไป)
  { mime: 'image/webp', magic: ascii('RIFF'), extra: (bytes) => ascii('WEBP').every((code, index) => bytes[8 + index] === code) },
  { mime: 'application/pdf', magic: ascii('%PDF-') },
  // เอกสาร Office ยุคใหม่ (docx/xlsx) เป็น ZIP ส่วนยุคเก่า (doc/xls) เป็น OLE2 — แยกจากกันตรงนี้ไม่ได้
  // ต้องอาศัยชนิดที่ประกาศมาช่วยจำแนกอีกชั้น จึงตั้งเป็นกลุ่มไว้ก่อน
  { mime: 'application/zip', magic: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/zip', magic: [0x50, 0x4b, 0x05, 0x06] },
  { mime: 'application/x-ole-storage', magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
];

/** ชนิดที่ประกาศได้ เมื่อเนื้อไฟล์เป็น ZIP container */
const ZIP_BACKED = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** ชนิดที่ประกาศได้ เมื่อเนื้อไฟล์เป็น OLE2 container */
const OLE_BACKED = new Set(['application/msword', 'application/vnd.ms-excel']);

/** เนื้อหาที่เบราว์เซอร์อาจรันเป็นสคริปต์ได้ ต้องปฏิเสธเสมอไม่ว่าจะประกาศชนิดใดมา */
const SCRIPTABLE_MARKERS = ['<!doctype html', '<html', '<script', '<svg', '<?php', '<%'];

export interface SignatureResult {
  ok: boolean;
  /** ชนิดที่ควรใช้เก็บจริง (มาจากเนื้อไฟล์) — ใช้เมื่อ ok เป็น true */
  resolvedMime?: string;
  reason?: string;
}

function matches(bytes: Uint8Array, signature: Signature): boolean {
  const offset = signature.offset ?? 0;
  if (bytes.length < offset + signature.magic.length) return false;
  const headMatches = signature.magic.every((code, index) => bytes[offset + index] === code);
  return headMatches && (signature.extra?.(bytes) ?? true);
}

/**
 * ข้อความที่อ่านเป็น UTF-8 ได้และไม่มีไบต์ศูนย์ ถือว่าเป็น text/plain ที่ยอมรับได้
 *
 * ต้องถอดรหัสแบบ stream เพราะเราอ่านมาแค่หัวไฟล์ อักษรไทยใช้ 3 ไบต์ต่อตัว การตัดที่ไบต์ที่ 64
 * จึงผ่ากลางตัวอักษรได้บ่อยมาก ถ้าถอดรหัสแบบไม่ stream ตัวสุดท้ายที่ถูกตัดครึ่งจะทำให้ทั้งไฟล์
 * ถูกตัดสินว่าไม่ใช่ข้อความ — ไฟล์ .txt ภาษาไทยของจริงจะอัปโหลดไม่ได้เลย
 */
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * ตรวจว่าเนื้อไฟล์ตรงกับชนิดที่ประกาศมาหรือไม่
 * คืน resolvedMime ที่ควรใช้เก็บลงฐานข้อมูลและ Storage แทนค่าที่ Client ส่งมา
 */
export async function verifyFileSignature(file: File, declaredMime: string): Promise<SignatureResult> {
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());

  if (header.length === 0) {
    return { ok: false, reason: 'ไฟล์ว่างเปล่า' };
  }

  // ปฏิเสธเนื้อหาที่เบราว์เซอร์รันได้ก่อนเสมอ แม้จะประกาศมาเป็นรูปภาพหรือข้อความก็ตาม
  const headText = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(header).trim().toLowerCase();
  if (SCRIPTABLE_MARKERS.some((marker) => headText.startsWith(marker))) {
    return { ok: false, reason: 'เนื้อหาไฟล์เป็นสคริปต์หรือ HTML ซึ่งไม่อนุญาตให้อัปโหลด' };
  }

  const detected = SIGNATURES.find((signature) => matches(header, signature));

  if (detected) {
    if (detected.mime === 'application/zip') {
      return ZIP_BACKED.has(declaredMime)
        ? { ok: true, resolvedMime: declaredMime }
        : { ok: false, reason: 'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่ระบุ' };
    }
    if (detected.mime === 'application/x-ole-storage') {
      return OLE_BACKED.has(declaredMime)
        ? { ok: true, resolvedMime: declaredMime }
        : { ok: false, reason: 'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่ระบุ' };
    }
    return detected.mime === declaredMime
      ? { ok: true, resolvedMime: detected.mime }
      : { ok: false, reason: 'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่ระบุ' };
  }

  // ไม่มีลายเซ็นตรงกับรูปแบบใด — ยอมรับได้เฉพาะกรณีประกาศเป็นข้อความล้วนและเนื้อหาเป็นข้อความจริง
  if (declaredMime === 'text/plain') {
    return looksLikeText(header)
      ? { ok: true, resolvedMime: 'text/plain' }
      : { ok: false, reason: 'เนื้อหาไฟล์ไม่ใช่ข้อความล้วนตามที่ระบุ' };
  }

  return { ok: false, reason: 'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่ระบุ' };
}
