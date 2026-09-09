import { createSign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

/**
 * คัดลอกไฟล์สำรองหนึ่งชุดขึ้น Google Drive เป็นสำเนานอกที่เก็บหลัก
 *
 * R2 คือที่เก็บสำเนาหลัก สคริปต์นี้ไม่ได้มาแทนที่ แต่มาเพิ่มสำเนาที่สองไว้คนละผู้ให้บริการ —
 * เหตุที่ทำให้เข้าถึง R2 ไม่ได้ (บัญชี Cloudflare ถูกระงับ, token ถูกเพิกถอน, ลบผิดชุด) มักไม่ใช่
 * เหตุเดียวกับที่ทำให้เข้าถึง Google Drive ไม่ได้ในเวลาเดียวกัน
 *
 * ⚠ ไฟล์สำรองมีข้อมูลส่วนบุคคลและ hash รหัสผ่านจาก auth.users — โฟลเดอร์ปลายทางต้องเป็น
 *   โฟลเดอร์เฉพาะของงานสำรองข้อมูล ห้ามใช้โฟลเดอร์เดียวกับที่ใช้ส่งออกรายงาน/Google Sheets
 *   ซึ่งเปิดให้คนในทีมเข้าดูได้ (GOOGLE_DRIVE_FOLDER_ID) จึงบังคับให้ตั้งเป็นคนละค่ากัน
 *
 * ล้มเหลวแล้วต้องดังเสมอ ด้วยเหตุผลเดียวกับ backup-storage.mjs — สำเนาที่คิดว่ามีแต่จริง ๆ ไม่มี
 * อันตรายกว่างานที่ fail ให้เห็น
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`backup-to-drive: ${name} is required.`);
    process.exit(1);
  }
  return value;
}

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

/** JWT ของ Service Account — รูปแบบเดียวกับที่ Worker ใช้ (apps/api/src/services/googleDriveService.ts) */
async function getAccessToken(clientEmail, privateKey) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = [
    base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    base64Url(JSON.stringify({
      iss: clientEmail,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    })),
  ].join('.');

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  // ค่าที่ก๊อปจากไฟล์ JSON มักมี \n เป็นตัวอักษรสองตัว ต้องแปลงกลับก่อนไม่งั้น sign จะล้ม
  const assertion = `${unsigned}.${signer.sign(privateKey.replace(/\\n/g, '\n'), 'base64url')}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) {
    throw new Error(`ขอ access token จาก Google ไม่สำเร็จ (HTTP ${response.status}) — ตรวจ Service Account และการเปิดใช้ Drive API`);
  }
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Google ไม่ได้คืน access token กลับมา');
  return payload.access_token;
}

/**
 * อัปโหลดแบบ resumable — ไฟล์สำรองโตได้ถึงหลายร้อย MB การอ่านทั้งไฟล์เข้าหน่วยความจำก่อนส่ง
 * จะทำให้ runner ตายเมื่อข้อมูลจริงโตขึ้น จึงส่งเป็นสตรีมและบอกขนาดล่วงหน้าแทน
 */
async function uploadResumable(token, filePath, folderId) {
  const size = (await stat(filePath)).size;
  const name = basename(filePath);

  const start = await fetch(`${UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/gzip',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  if (!start.ok) {
    throw new Error(`เริ่มการอัปโหลดไม่สำเร็จ (HTTP ${start.status}) — ตรวจว่า Service Account มีสิทธิ์เขียนในโฟลเดอร์สำรองข้อมูล`);
  }
  const sessionUrl = start.headers.get('location');
  if (!sessionUrl) throw new Error('Google ไม่ได้คืน URL ของ session อัปโหลดกลับมา');

  const response = await fetch(sessionUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(size) },
    body: createReadStream(filePath),
    duplex: 'half',
  });
  if (!response.ok) throw new Error(`อัปโหลดไฟล์สำรองไม่สำเร็จ (HTTP ${response.status})`);

  const created = await response.json();
  if (!created.id) throw new Error('Google ไม่ได้คืนรหัสไฟล์กลับมา');
  return { id: created.id, name, size };
}

/** สำเนาที่ไม่เคยตรวจว่าขึ้นไปครบ ไม่นับว่าเป็นสำเนา — ถามขนาดที่ Drive เก็บจริงกลับมาเทียบ */
async function verifyUploadedSize(token, fileId, expectedSize) {
  const response = await fetch(`${FILES_URL}/${fileId}?fields=id,name,size&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`อ่านข้อมูลไฟล์ที่อัปโหลดกลับมาไม่ได้ (HTTP ${response.status})`);
  const file = await response.json();
  const storedSize = Number(file.size);
  if (storedSize !== expectedSize) {
    throw new Error(`ขนาดไฟล์บน Drive (${storedSize} ไบต์) ไม่ตรงกับต้นฉบับ (${expectedSize} ไบต์)`);
  }
  return file;
}

async function main() {
  const archivePath = resolve(requireEnv('BACKUP_ARCHIVE'));
  const clientEmail = requireEnv('GOOGLE_SA_CLIENT_EMAIL');
  const privateKey = requireEnv('GOOGLE_SA_PRIVATE_KEY');
  const folderId = requireEnv('GOOGLE_DRIVE_BACKUP_FOLDER_ID');

  const exportFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (exportFolderId && exportFolderId === folderId) {
    console.error(
      'backup-to-drive: GOOGLE_DRIVE_BACKUP_FOLDER_ID ต้องเป็นคนละโฟลเดอร์กับ GOOGLE_DRIVE_FOLDER_ID '
      + '— ไฟล์สำรองมีข้อมูลส่วนบุคคลและ hash รหัสผ่าน ห้ามอยู่ในโฟลเดอร์ที่เปิดให้ทีมเข้าดูรายงาน',
    );
    process.exit(1);
  }

  const token = await getAccessToken(clientEmail, privateKey);
  const uploaded = await uploadResumable(token, archivePath, folderId);
  // เรียกเพื่อผลข้างเคียงล้วน ๆ — ฟังก์ชันนี้โยน error เมื่อขนาดบน Drive ไม่ตรงกับต้นฉบับ
  await verifyUploadedSize(token, uploaded.id, uploaded.size);

  // รายงานด้วย `uploaded.name` ซึ่งเป็น basename ของไฟล์ที่เราส่งขึ้นไปเอง ไม่ใช่ชื่อที่ Drive
  // ส่งกลับมา ชื่อจาก response เป็นข้อมูลนอกระบบ ถ้าเขียนลง step summary ตรง ๆ การขึ้นบรรทัดใหม่
  // หรือ backtick ในชื่อจะแทรก markdown ปลอมเข้าไปในรายงานของ run ได้
  console.log(`backup-to-drive: อัปโหลด ${uploaded.name} (${uploaded.size} ไบต์) และตรวจขนาดตรงกับต้นฉบับแล้ว`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `- สำเนานอก R2: Google Drive \`${uploaded.name}\` (ตรวจขนาดตรงกับต้นฉบับแล้ว)\n`,
    );
  }
}

main().catch((error) => {
  console.error(`backup-to-drive: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
