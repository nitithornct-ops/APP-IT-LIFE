import { spawnSync } from 'node:child_process';

/**
 * ด่านตรวจช่องโหว่ของ dependency ฝั่ง production
 *
 * `npm audit` คืน exit 1 ทั้งกรณี "พบช่องโหว่ระดับ high ขึ้นไป" และกรณี "ต่อ endpoint ของ registry
 * ไม่ได้" ซึ่งเป็นคนละเรื่องกันโดยสิ้นเชิง — อย่างแรกคือสิ่งที่เราตั้งด่านนี้ไว้ดัก ส่วนอย่างหลังคือ
 * ปัญหาเครือข่ายของคนอื่น ที่นี่จึงแยกสองกรณีออกจากกัน แล้วลองใหม่เฉพาะกรณีหลัง
 *
 * ทำไมต้องมี: 2026-09-04 endpoint ตอบ 503 แล้ว 400 สลับกันสองรอบติดใน PR Checks ทั้งที่ status page
 * ของ npm ไม่มีเหตุขัดข้องและคำสั่งเดียวกันรันในเครื่องผ่าน — ด่านนี้อยู่ในงาน Deploy Production ด้วย
 * ถ้าปล่อยไว้ การปล่อยรุ่นจะถูกล้มกลางทางด้วยเรื่องที่ไม่เกี่ยวกับคุณภาพของรุ่นเลย
 *
 * สิ่งที่ "ไม่" ทำ: ไม่ผ่อนเกณฑ์ ไม่ข้ามด่านเมื่อ retry หมดแล้ว — ลองครบแล้วยังต่อไม่ได้ถือว่าล้ม
 * เพราะการปล่อยผ่านโดยไม่ได้ตรวจ มีค่าเท่ากับไม่มีด่านนี้อยู่เลย
 */

const ATTEMPTS = 3;
const BACKOFF_MS = [5_000, 20_000];

/** ข้อความที่บอกว่าปัญหาอยู่ที่การเชื่อมต่อ ไม่ใช่ผลการตรวจ */
const TRANSPORT_ERRORS = [
  'audit endpoint returned an error',
  'Service Unavailable',
  'Bad Request',
  'Gateway Timeout',
  'Internal Server Error',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'socket hang up',
  'network timeout',
];

/**
 * `--fetch-timeout` / `--fetch-retries` ถูกบีบให้สั้นกว่าค่าเริ่มต้นของ npm (5 นาทีต่อคำขอ) โดยตั้งใจ
 * เพราะที่นี่มีวงจรลองใหม่ของตัวเองอยู่แล้ว ถ้าปล่อยค่าเดิม สามรอบจะกินเวลาเกินสิบห้านาทีทั้งที่
 * ปลายทางไม่ตอบตั้งแต่รอบแรก
 */
const AUDIT_ARGS = [
  'audit',
  '--omit=dev',
  '--audit-level=high',
  '--fetch-timeout=60000',
  '--fetch-retries=1',
];

/**
 * เรียก npm ผ่านไฟล์ CLI ที่ npm บอกมาเองใน npm_execpath แทนการยิงผ่าน shell — บน Windows การเรียก
 * `npm` ตรง ๆ ต้องพึ่ง shell ซึ่ง Node เตือนเรื่องการต่อสตริง argument (DEP0190) ส่วนบน CI ไม่ต่างกัน
 */
function runAudit() {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    return spawnSync(process.execPath, [npmCli, ...AUDIT_ARGS], { encoding: 'utf8' });
  }
  return spawnSync('npm', AUDIT_ARGS, { encoding: 'utf8', shell: process.platform === 'win32' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  const result = runAudit();
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);

  if (result.status === 0) {
    process.exit(0);
  }

  const transportFailure = TRANSPORT_ERRORS.some((marker) => output.includes(marker));
  if (!transportFailure) {
    // ผลการตรวจจริง — ล้มทันที ไม่ต้องลองใหม่ให้เสียเวลา ช่องโหว่ไม่หายไปเองระหว่างรอ
    console.error('Production audit failed: npm audit reported findings at or above the high severity level.');
    process.exit(result.status ?? 1);
  }

  if (attempt < ATTEMPTS) {
    const delay = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1);
    console.error(`Production audit attempt ${attempt}/${ATTEMPTS} could not reach the npm audit endpoint; retrying in ${delay / 1000}s.`);
    await sleep(delay);
  }
}

console.error(`Production audit failed: the npm audit endpoint was unreachable after ${ATTEMPTS} attempts, so this release was never actually audited.`);
process.exit(1);
