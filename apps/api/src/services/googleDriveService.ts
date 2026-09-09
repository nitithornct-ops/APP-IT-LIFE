import type { Bindings } from '../types';

/**
 * ส่งไฟล์ออกไป Google Drive ด้วย Service Account (JWT RS256 → access token → Drive API v3)
 *
 * ทำฝั่ง Worker เท่านั้น เพราะ credential ของ Service Account เป็นกุญแจของทั้งโฟลเดอร์
 * ถ้าเอาไปไว้ที่ browser คือแจกสิทธิ์เขียน Drive ให้ทุกคนที่เปิดหน้าเว็บ — และการทำที่ Worker
 * ยังทำให้ apps/web ไม่ต้องเปิด connect-src ของ CSP ไปหา googleapis.com เพิ่ม
 *
 * Supabase Storage ยังเป็นที่เก็บไฟล์หลักของระบบเหมือนเดิม (services/storageService.ts)
 * ที่นี่คือ "ปลายทางส่งออก" สำหรับให้คนเปิดดู/แก้ต่อใน Google Sheets ได้เท่านั้น
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
/**
 * ต้องใช้ scope เต็ม ไม่ใช่ drive.file เพราะไฟล์ถูกเขียนลงโฟลเดอร์ที่ "คนสร้างไว้ก่อน" ใน Shared
 * Drive — drive.file มองไม่เห็นโฟลเดอร์ที่แอปไม่ได้สร้างเอง จึงเขียนลงไปไม่ได้ ขอบเขตความเสี่ยง
 * ถูกจำกัดด้วยการให้ Service Account เป็นสมาชิกเฉพาะ Shared Drive ที่ใช้กับระบบนี้เท่านั้น
 */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TIMEOUT_MS = 20_000;

export interface GoogleDriveConfig {
  clientEmail: string;
  privateKey: string;
  /** โฟลเดอร์ปลายทางใน Shared Drive ที่ Service Account เป็นสมาชิกอยู่ */
  folderId: string;
}

export type GoogleDriveFailureReason = 'configuration' | 'auth' | 'network' | 'response' | 'rejected';

export interface GoogleDriveFile {
  id: string;
  name: string;
  /** ลิงก์เปิดใน Google Sheets/Docs — คืนให้หน้าเว็บพาผู้ใช้ไปต่อได้ทันที */
  webViewLink: string;
}

export type GoogleDriveResult =
  | { ok: true; file: GoogleDriveFile }
  | { ok: false; reason: GoogleDriveFailureReason; message: string };

/**
 * ฟีเจอร์ปิดเป็นค่าเริ่มต้น: ต้องตั้ง GOOGLE_DRIVE_ENABLED=true และมี credential ครบทั้งชุด
 * ขาดอย่างใดอย่างหนึ่งถือว่ายังไม่ได้ตั้งค่า ไม่ใช่ตั้งค่าครึ่ง ๆ กลาง ๆ แล้วไปพังตอนผู้ใช้กดส่งออก
 */
export function googleDriveConfig(env: Bindings): GoogleDriveConfig | null {
  if (env.GOOGLE_DRIVE_ENABLED !== 'true') return null;
  const clientEmail = env.GOOGLE_SA_CLIENT_EMAIL?.trim();
  const privateKey = env.GOOGLE_SA_PRIVATE_KEY?.trim();
  const folderId = env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!clientEmail || !privateKey || !folderId) return null;
  return { clientEmail, privateKey, folderId };
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlText(text: string): string {
  return base64Url(new TextEncoder().encode(text));
}

/**
 * PEM ของ Service Account ถูกเก็บเป็น Worker secret ซึ่งมักถูกวางมาแบบ \n เป็นตัวอักษรสองตัว
 * (คัดลอกจากไฟล์ JSON ตรง ๆ) จึงต้องแปลงกลับก่อน ไม่งั้น importKey จะล้มโดยไม่บอกสาเหตุที่แท้จริง
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const der = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(der), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** access token มีอายุ 1 ชั่วโมง — cache ระดับ isolate จะได้ไม่ยิงขอใหม่ทุกครั้งที่มีคนกดส่งออก */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(
  config: GoogleDriveConfig,
  fetchImpl: typeof fetch,
  now: number,
): Promise<{ ok: true; token: string } | { ok: false; reason: GoogleDriveFailureReason }> {
  const cached = tokenCache.get(config.clientEmail);
  // เผื่อ 60 วินาที กันกรณี token หมดอายุระหว่างที่ request กำลังเดินทางไป Google
  if (cached && cached.expiresAt - 60_000 > now) return { ok: true, token: cached.token };

  const issuedAt = Math.floor(now / 1000);
  const claim = {
    iss: config.clientEmail,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const unsigned = `${base64UrlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64UrlText(JSON.stringify(claim))}`;

  let assertion: string;
  try {
    const key = await importPrivateKey(config.privateKey);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    assertion = `${unsigned}.${base64Url(signature)}`;
  } catch {
    // กุญแจผิดรูปแบบคือปัญหาการตั้งค่า ไม่ใช่ปัญหาชั่วคราวที่ลองใหม่แล้วจะหาย
    return { ok: false, reason: 'configuration' };
  }

  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!response.ok) return { ok: false, reason: 'auth' };

  let payload: { access_token?: unknown; expires_in?: unknown };
  try {
    payload = await response.json() as typeof payload;
  } catch {
    return { ok: false, reason: 'response' };
  }
  const token = typeof payload.access_token === 'string' ? payload.access_token : '';
  if (!token) return { ok: false, reason: 'auth' };

  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  tokenCache.set(config.clientEmail, { token, expiresAt: now + expiresIn * 1000 });
  return { ok: true, token };
}

/** ชื่อไฟล์ที่ผู้ใช้เห็นใน Drive — ตัด path separator กับอักขระควบคุมที่ทำให้ชื่อไฟล์เพี้ยน */
export function safeDriveName(name: string, fallback: string): string {
  const cleaned = name
    .split('')
    .map((char) => (char === '/' || char === '\\' || char < ' ' ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return cleaned || fallback;
}

/** ปีปัจจุบันเป็น พ.ศ. — ใช้ตั้งชื่อโฟลเดอร์รายปีแบบเดียวกับระบบเดิม (legacy-gas/Drive.gs) */
export function buddhistYearFolder(now = new Date()): string {
  return String(now.getFullYear() + 543);
}

/** cache รหัสโฟลเดอร์รายปี จะได้ไม่ต้องค้นหา/สร้างซ้ำทุกครั้งที่ส่งออก */
const folderCache = new Map<string, string>();

/** ล้าง cache ทั้งของ token และโฟลเดอร์ — ใช้ในเทสต์ ไม่ให้เคสหนึ่งหยิบของอีกเคสไปใช้ */
export function resetGoogleDriveCaches(): void {
  tokenCache.clear();
  folderCache.clear();
}

/**
 * หาโฟลเดอร์ย่อยชื่อที่ต้องการ ถ้ายังไม่มีก็สร้าง — โครงสร้างเดียวกับระบบเดิมคือแยกตามปี พ.ศ.
 * เพื่อไม่ให้โฟลเดอร์เดียวมีไฟล์สะสมจนหาอะไรไม่เจอในไม่กี่ปี
 *
 * ถ้าขั้นตอนนี้ล้มจะคืน null เพื่อให้ผู้เรียกวางไฟล์ไว้ที่โฟลเดอร์หลักแทน — ผู้ใช้ยังได้ไฟล์ที่ถูกต้อง
 * ในที่ที่หาเจอ ดีกว่าล้มทั้งการส่งออกเพราะเรื่องการจัดโฟลเดอร์
 */
async function ensureSubFolder(
  parentId: string,
  name: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const cacheKey = `${parentId}/${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const headers = { Authorization: `Bearer ${token}` };
  const sharedDriveParams = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
  try {
    // ต้อง escape backslash ก่อน single quote เสมอ ถ้าสลับลำดับ backslash ที่เพิ่งใส่ให้ ' จะถูก
    // escape ซ้ำจนกลายเป็น \\' ซึ่งปิด escape ตัวเอง แล้วเครื่องหมายคำพูดจะหลุดออกจาก string ใน
    // query ของ Drive ทำให้ชื่อโฟลเดอร์ที่มี \ หรือ ' แก้ความหมายของ query ทั้งก้อนได้
    const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = `name='${escapedName}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const listResponse = await fetchImpl(
      `${FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1&${sharedDriveParams}`,
      { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (listResponse.ok) {
      const listed = await listResponse.json() as { files?: { id?: unknown }[] };
      const existingId = listed.files?.[0]?.id;
      if (typeof existingId === 'string' && existingId) {
        folderCache.set(cacheKey, existingId);
        return existingId;
      }
    }

    const createResponse = await fetchImpl(`${FILES_URL}?fields=id&${sharedDriveParams}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parentId], mimeType: FOLDER_MIME }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!createResponse.ok) return null;
    const created = await createResponse.json() as { id?: unknown };
    if (typeof created.id !== 'string' || !created.id) return null;
    folderCache.set(cacheKey, created.id);
    return created.id;
  } catch {
    return null;
  }
}

export interface DriveUploadInput {
  name: string;
  /** ชนิดของเนื้อไฟล์ที่ส่งขึ้นไป เช่น text/csv, application/pdf */
  contentType: string;
  content: string | ArrayBuffer | Uint8Array;
  /**
   * ชนิดปลายทางใน Drive — ใส่เมื่อต้องการให้ Drive "แปลง" ไฟล์เป็นเอกสาร Google
   * (text/csv → Google Sheets) ถ้าไม่ใส่จะเก็บเป็นไฟล์ดิบตามเดิม
   */
  convertToMimeType?: string;
  /** โฟลเดอร์ย่อยใต้โฟลเดอร์หลัก เช่น '2569' — ไม่ใส่คือวางไว้ที่โฟลเดอร์หลักเลย */
  subFolder?: string;
}

/**
 * อัปโหลดไฟล์เดียวแบบ multipart — ใช้ได้ทั้ง CSV ที่ให้ Drive แปลงเป็น Sheets และไฟล์ดิบ (PDF/สำรองข้อมูล)
 * ทุกเส้นทางที่ผิดพลาดคืน reason ที่ระบุสาเหตุ ไม่โยน exception ให้ route ต้องเดาเอง
 */
export async function uploadToDrive(
  env: Bindings,
  input: DriveUploadInput,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<GoogleDriveResult> {
  const config = googleDriveConfig(env);
  if (!config) {
    return { ok: false, reason: 'configuration', message: 'ยังไม่ได้เปิดใช้งานการเชื่อมต่อ Google Drive' };
  }

  const auth = await getAccessToken(config, fetchImpl, now);
  if (!auth.ok) {
    return {
      ok: false,
      reason: auth.reason,
      message: auth.reason === 'network'
        ? 'เชื่อมต่อ Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
        : 'ยืนยันสิทธิ์กับ Google Drive ไม่สำเร็จ กรุณาตรวจสอบการตั้งค่า Service Account',
    };
  }

  const parentId = input.subFolder
    ? (await ensureSubFolder(config.folderId, input.subFolder, auth.token, fetchImpl)) ?? config.folderId
    : config.folderId;

  const boundary = `itlife-${crypto.randomUUID()}`;
  const metadata: Record<string, unknown> = { name: input.name, parents: [parentId] };
  if (input.convertToMimeType) metadata.mimeType = input.convertToMimeType;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${input.contentType}\r\n\r\n`,
    input.content,
    `\r\n--${boundary}--\r\n`,
  ]);

  let response: Response;
  try {
    response = await fetchImpl(`${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'network', message: 'ส่งไฟล์ไป Google Drive ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
  }

  if (!response.ok) {
    // token ถูกเพิกถอนก่อนหมดอายุได้ — ทิ้ง cache เพื่อให้ครั้งถัดไปขอใหม่ ไม่ใช่ล้มซ้ำจนกว่าจะหมดอายุ
    if (response.status === 401) tokenCache.delete(config.clientEmail);
    return {
      ok: false,
      reason: 'rejected',
      message: response.status === 403 || response.status === 404
        ? 'Google Drive ปฏิเสธคำขอ กรุณาตรวจสอบว่า Service Account มีสิทธิ์เขียนในโฟลเดอร์ปลายทาง'
        : 'Google Drive ปฏิเสธคำขอ กรุณาลองใหม่อีกครั้ง',
    };
  }

  let created: { id?: unknown; name?: unknown; webViewLink?: unknown };
  try {
    created = await response.json() as typeof created;
  } catch {
    return { ok: false, reason: 'response', message: 'Google Drive ตอบกลับในรูปแบบที่อ่านไม่ได้' };
  }
  if (typeof created.id !== 'string' || !created.id) {
    return { ok: false, reason: 'response', message: 'Google Drive ตอบกลับในรูปแบบที่อ่านไม่ได้' };
  }

  return {
    ok: true,
    file: {
      id: created.id,
      name: typeof created.name === 'string' ? created.name : input.name,
      webViewLink: typeof created.webViewLink === 'string'
        ? created.webViewLink
        : `https://drive.google.com/file/d/${created.id}/view`,
    },
  };
}

/**
 * ส่ง CSV ขึ้นไปโดยให้ Drive แปลงเป็น Google Sheets ตัวจริง (เปิด/แก้/แชร์ต่อได้ทันที)
 *
 * ไม่ใส่ BOM เหมือนไฟล์ที่ให้ดาวน์โหลด เพราะ Drive อ่าน UTF-8 อยู่แล้ว การใส่ BOM กลับทำให้
 * หัวคอลัมน์แรกมีอักขระแปลกปลอมติดไปในชีต
 */
export async function uploadCsvAsGoogleSheet(
  env: Bindings,
  input: { name: string; csv: string },
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<GoogleDriveResult> {
  return uploadToDrive(
    env,
    {
      name: safeDriveName(input.name.replace(/\.csv$/i, ''), 'export'),
      contentType: 'text/csv; charset=UTF-8',
      content: input.csv,
      convertToMimeType: GOOGLE_SHEET_MIME,
      subFolder: buddhistYearFolder(now),
    },
    fetchImpl,
    now.getTime(),
  );
}
