import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buddhistYearFolder,
  googleDriveConfig,
  resetGoogleDriveCaches,
  safeDriveName,
  uploadCsvAsGoogleSheet,
} from '../src/services/googleDriveService';
import type { Bindings } from '../src/types';

/**
 * เทียบ host แบบเต็มค่า ไม่ใช่ substring — `includes('oauth2.googleapis.com')` จะจริงกับ URL อย่าง
 * `https://oauth2.googleapis.com.attacker.test/` ด้วย การนับ call ผิดตัวทำให้เทสต์ที่ควรจับ
 * พฤติกรรม token cache ผิดพลาดกลายเป็นผ่านไปเงียบ ๆ
 */
function isTokenCall(url: unknown): boolean {
  try {
    return new URL(String(url)).hostname === 'oauth2.googleapis.com';
  } catch {
    return false;
  }
}

/** กุญแจจริงสำหรับเซ็น JWT — เทสต์ต้องพิสูจน์ว่า importKey/sign ทำงานกับ PEM รูปแบบที่ Google ให้มาจริง */
async function generatePrivateKeyPem(): Promise<string> {
  // workers-types ประกาศ generateKey/exportKey แบบกว้างกว่า lib.dom จึงต้องระบุชนิดที่ใช้จริงเอง
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer);
  let binary = '';
  for (const byte of pkcs8) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

const baseEnv: Bindings = {
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: 'https://support.example.com',
  ENVIRONMENT: 'test',
};

let privateKeyPem: string;
let env: Bindings;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

/** fetch ปลอมที่ตอบตามลำดับจริงของ Drive: ขอ token → หาโฟลเดอร์ปี → สร้างโฟลเดอร์ → อัปโหลด */
function driveFetchMock(overrides: { upload?: Response; folderExists?: boolean } = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'test-access-token', expires_in: 3600 });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      return jsonResponse({ files: overrides.folderExists ? [{ id: 'folder-2569' }] : [] });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?fields=id')) {
      return jsonResponse({ id: 'folder-2569' });
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      return overrides.upload ?? jsonResponse({
        id: 'sheet-1',
        name: 'tickets-2026-09-09',
        webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

beforeEach(async () => {
  resetGoogleDriveCaches();
  privateKeyPem ??= await generatePrivateKeyPem();
  env = {
    ...baseEnv,
    GOOGLE_DRIVE_ENABLED: 'true',
    GOOGLE_SA_CLIENT_EMAIL: 'itlife@example.iam.gserviceaccount.com',
    GOOGLE_SA_PRIVATE_KEY: privateKeyPem,
    GOOGLE_DRIVE_FOLDER_ID: 'shared-drive-folder',
  };
});

describe('googleDriveConfig', () => {
  it('ถือว่าปิดอยู่เมื่อไม่ได้ตั้ง GOOGLE_DRIVE_ENABLED เป็น true', () => {
    expect(googleDriveConfig({ ...env, GOOGLE_DRIVE_ENABLED: undefined })).toBeNull();
    expect(googleDriveConfig({ ...env, GOOGLE_DRIVE_ENABLED: 'false' })).toBeNull();
  });

  it('ถือว่าปิดอยู่เมื่อ credential ไม่ครบ ไม่ใช่เปิดแบบครึ่ง ๆ กลาง ๆ', () => {
    expect(googleDriveConfig({ ...env, GOOGLE_SA_PRIVATE_KEY: undefined })).toBeNull();
    expect(googleDriveConfig({ ...env, GOOGLE_DRIVE_FOLDER_ID: '   ' })).toBeNull();
    expect(googleDriveConfig(env)).toEqual({
      clientEmail: 'itlife@example.iam.gserviceaccount.com',
      privateKey: privateKeyPem.trim(),
      folderId: 'shared-drive-folder',
    });
  });
});

describe('uploadCsvAsGoogleSheet', () => {
  it('ไม่ยิงออกไปเลยเมื่อยังไม่ได้ตั้งค่า', async () => {
    const fetchMock = driveFetchMock();
    const result = await uploadCsvAsGoogleSheet(
      { ...env, GOOGLE_DRIVE_ENABLED: 'false' },
      { name: 'tickets.csv', csv: 'a\r\nb' },
      fetchMock,
    );
    expect(result).toMatchObject({ ok: false, reason: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('เซ็น JWT ด้วยกุญแจจริง แล้วอัปโหลดแบบสั่งให้ Drive แปลงเป็น Google Sheets', async () => {
    const fetchMock = driveFetchMock();
    const now = new Date('2026-09-09T03:00:00.000Z');
    const result = await uploadCsvAsGoogleSheet(env, { name: 'tickets-2026-09-09.csv', csv: 'หัวข้อ\r\nงานแรก' }, fetchMock, now);

    expect(result).toEqual({
      ok: true,
      file: { id: 'sheet-1', name: 'tickets-2026-09-09', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-1/edit' },
    });

    const tokenCall = fetchMock.mock.calls.find(([url]) => isTokenCall(url))!;
    const assertion = (tokenCall[1]?.body as URLSearchParams).get('assertion')!;
    const [header, payload] = assertion.split('.');
    expect(JSON.parse(atob(header!))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(atob(payload!))).toMatchObject({
      iss: 'itlife@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(assertion.split('.')[2]!.length).toBeGreaterThan(0);

    const uploadCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/upload/drive/v3/files'))!;
    expect(String(uploadCall[0])).toContain('uploadType=multipart');
    expect(String(uploadCall[0])).toContain('supportsAllDrives=true');
    const body = await (uploadCall[1]!.body as Blob).text();
    // ชื่อไฟล์ต้องถูกตัด .csv ออก และไฟล์ต้องถูกวางในโฟลเดอร์ปี พ.ศ. ไม่ใช่โฟลเดอร์หลัก
    expect(body).toContain('"name":"tickets-2026-09-09"');
    expect(body).toContain('"mimeType":"application/vnd.google-apps.spreadsheet"');
    expect(body).toContain(`"parents":["folder-${buddhistYearFolder(now)}"]`);
    expect(body).toContain('Content-Type: text/csv; charset=UTF-8');
    expect(body).toContain('หัวข้อ');
    // ไม่ใส่ BOM เพราะจะกลายเป็นอักขระแปลกปลอมในหัวคอลัมน์แรกของชีต
    expect(body).not.toContain('﻿');
  });

  it('ใช้โฟลเดอร์ปีเดิมเมื่อมีอยู่แล้ว และขอ token ครั้งเดียวเมื่อส่งออกซ้ำ', async () => {
    const fetchMock = driveFetchMock({ folderExists: true });
    await uploadCsvAsGoogleSheet(env, { name: 'a.csv', csv: 'a' }, fetchMock);
    await uploadCsvAsGoogleSheet(env, { name: 'b.csv', csv: 'b' }, fetchMock);

    expect(fetchMock.mock.calls.filter(([url]) => isTokenCall(url))).toHaveLength(1);
    // โฟลเดอร์ปีถูก cache ไว้แล้ว ครั้งที่สองจึงไม่ต้องค้นหาซ้ำ
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/drive/v3/files?q='))).toHaveLength(1);
  });

  it('ยังส่งไฟล์ลงโฟลเดอร์หลักได้เมื่อจัดโฟลเดอร์รายปีไม่สำเร็จ', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return jsonResponse({ access_token: 't', expires_in: 3600 });
      if (url.startsWith('https://www.googleapis.com/drive/v3/files')) return jsonResponse({ error: 'nope' }, 403);
      return jsonResponse({ id: 'sheet-2', name: 'a', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-2/edit' });
    });

    const result = await uploadCsvAsGoogleSheet(env, { name: 'a.csv', csv: 'a' }, fetchMock);
    expect(result).toMatchObject({ ok: true });
    const uploadCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/upload/drive/v3/files'))!;
    expect(await (uploadCall[1]!.body as Blob).text()).toContain('"parents":["shared-drive-folder"]');
  });

  it('บอกได้ว่าเป็นเรื่องสิทธิ์ในโฟลเดอร์เมื่อ Drive ตอบ 403', async () => {
    const fetchMock = driveFetchMock({ upload: jsonResponse({ error: 'forbidden' }, 403) });
    const result = await uploadCsvAsGoogleSheet(env, { name: 'a.csv', csv: 'a' }, fetchMock);
    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    expect(result.ok === false && result.message).toContain('สิทธิ์เขียนในโฟลเดอร์ปลายทาง');
  });

  it('ขอ token ใหม่ในครั้งถัดไปเมื่อ Drive ตอบ 401 (token ถูกเพิกถอนก่อนหมดอายุ)', async () => {
    const fetchMock = driveFetchMock({ upload: jsonResponse({ error: 'unauthorized' }, 401) });
    await uploadCsvAsGoogleSheet(env, { name: 'a.csv', csv: 'a' }, fetchMock);
    await uploadCsvAsGoogleSheet(env, { name: 'b.csv', csv: 'b' }, fetchMock);
    expect(fetchMock.mock.calls.filter(([url]) => isTokenCall(url))).toHaveLength(2);
  });

  it('คืนสาเหตุเครือข่ายเมื่อยิงออกไปไม่ถึง Google', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const result = await uploadCsvAsGoogleSheet(env, { name: 'a.csv', csv: 'a' }, fetchMock);
    expect(result).toMatchObject({ ok: false, reason: 'network' });
  });

  it('ปฏิเสธกุญแจที่ผิดรูปแบบว่าเป็นปัญหาการตั้งค่า ไม่ใช่ปัญหาชั่วคราว', async () => {
    const fetchMock = driveFetchMock();
    const result = await uploadCsvAsGoogleSheet(
      { ...env, GOOGLE_SA_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----' },
      { name: 'a.csv', csv: 'a' },
      fetchMock,
    );
    expect(result).toMatchObject({ ok: false, reason: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('safeDriveName', () => {
  it('ตัด path separator กับอักขระควบคุมออกจากชื่อไฟล์', () => {
    expect(safeDriveName('a/b\\c', 'export')).toBe('a b c');
    expect(safeDriveName('     ', 'export')).toBe('export');
    expect(safeDriveName('x'.repeat(200), 'export')).toHaveLength(150);
  });
});

describe('buddhistYearFolder', () => {
  it('ตั้งชื่อโฟลเดอร์เป็นปี พ.ศ. แบบเดียวกับระบบเดิม', () => {
    expect(buddhistYearFolder(new Date('2026-09-09T12:00:00'))).toBe('2569');
  });
});
