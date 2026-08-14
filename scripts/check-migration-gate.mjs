import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * ด่านตรวจก่อน Production มีสองโหมด เพราะการ deploy มีสองสถานการณ์ที่ต่างกันจริง ๆ
 *
 *   legacy-import (ค่าเริ่มต้น) — ปล่อยรุ่นที่ยกข้อมูลจากระบบเดิมบน Google Sheets เข้ามาด้วย
 *     ต้องมีรายงานการซ้อมย้ายจริงที่ยังไม่เก่าเกินกำหนด ไม่มี SQL/Auth ล้มเหลว ไม่มี sheet ที่ยัง
 *     ไม่ได้ตรวจ mapping และไฟล์แนบทุกไฟล์ต้อง reconcile ได้
 *
 *   fresh-start — ปล่อยรุ่นที่ "ไม่ยกข้อมูลเดิมเข้ามาเลย" ผู้ใช้กรอกใหม่ทั้งหมด
 *     ด่านเดิมบังคับให้มีรายงานการซ้อมย้าย ซึ่งเป็นไปไม่ได้เมื่อไม่มีข้อมูลให้ย้าย และการปลอมรายงาน
 *     ขึ้นมาให้ผ่านคือการโกหกหลักฐาน โหมดนี้จึงเปลี่ยน "สิ่งที่ต้องพิสูจน์" แทนการปิดด่าน — ยังต้องมี
 *     เลขอนุมัติจากเจ้าของงาน และต้องมีคนพิมพ์คำประกาศชัดเจนว่ารุ่นนี้ไม่มีข้อมูลเดิม จึงยังตรวจสอบ
 *     ย้อนหลังได้ว่าใครเป็นผู้ประกาศและอ้างอิงเอกสารใด
 *
 * ทั้งสองโหมดยังบังคับ MIGRATION_APPROVAL_REF เหมือนกัน — ไม่มีเส้นทางไหน deploy ได้โดยไม่มีผู้รับผิดชอบ
 * (เพิ่มโหมด fresh-start ตอนเตรียม go-live 2026-08-14 ตามการตัดสินใจว่าโครงการนี้เริ่มข้อมูลใหม่ทั้งหมด)
 */

const reportPath = resolve(process.env.MIGRATION_REHEARSAL_REPORT ?? 'docs/migration/phase7-rehearsal-report.json');
const attachmentReportPath = resolve(process.env.MIGRATION_ATTACHMENT_REPORT ?? 'docs/migration/phase7-attachment-report.json');
const approvalRef = process.env.MIGRATION_APPROVAL_REF?.trim() ?? '';
const attachmentsApproved = process.env.MIGRATION_ATTACHMENTS_APPROVED === 'true';
const maxAgeDays = Number(process.env.MIGRATION_REPORT_MAX_AGE_DAYS ?? '14');
const mode = (process.env.MIGRATION_MODE ?? 'legacy-import').trim();

/** คำที่ต้องพิมพ์เพื่อประกาศว่ารุ่นนี้ไม่มีข้อมูลเดิม — ยาวพอที่จะไม่ถูกกดผ่านโดยไม่ได้อ่าน */
const FRESH_START_PHRASE = 'NO-LEGACY-DATA';
const MODES = ['legacy-import', 'fresh-start'];

function fail(message) {
  console.error(`Migration gate failed: ${message}`);
  process.exitCode = 1;
}

async function readJsonIfPresent(path) {
  try {
    return { present: true, value: JSON.parse(await readFile(path, 'utf8')) };
  } catch (error) {
    return { present: false, error };
  }
}

/**
 * โหมดไม่มีข้อมูลเดิม — สิ่งที่ต้องพิสูจน์คือ "เจตนา" ไม่ใช่ "ผลการซ้อมย้าย"
 */
async function checkFreshStart() {
  if (process.env.FRESH_START_CONFIRM?.trim() !== FRESH_START_PHRASE) {
    fail(`fresh-start mode requires FRESH_START_CONFIRM=${FRESH_START_PHRASE} to declare that this release imports no legacy data.`);
  }

  // ถ้ามีรายงานการซ้อมย้ายอยู่จริง แปลว่าเคยมีคนย้ายข้อมูล ซึ่งขัดกับคำประกาศ — ห้ามเดาแทนคน
  const rehearsal = await readJsonIfPresent(reportPath);
  if (rehearsal.present) {
    fail(`a rehearsal report exists at ${reportPath}, which contradicts the fresh-start declaration. Use MIGRATION_MODE=legacy-import, or remove the stale report deliberately and record why.`);
  }

  if (!process.exitCode) {
    console.log(`Migration gate passed (fresh-start): no legacy data imported; approval=${approvalRef}; declared=${FRESH_START_PHRASE}`);
  }
}

/**
 * โหมดยกข้อมูลจากระบบเดิม — ตรรกะเดิมทั้งหมด ไม่มีการผ่อนเกณฑ์ใด ๆ
 */
async function checkLegacyImport() {
  const rehearsal = await readJsonIfPresent(reportPath);
  if (!rehearsal.present) {
    fail(`cannot read a valid rehearsal report at ${reportPath}: ${rehearsal.error instanceof Error ? rehearsal.error.message : rehearsal.error}`);
    return;
  }
  const report = rehearsal.value;

  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) {
    fail('report.generatedAt is missing or invalid.');
  } else {
    const ageDays = (Date.now() - Date.parse(report.generatedAt)) / 86_400_000;
    if (ageDays < 0 || ageDays > maxAgeDays) fail(`rehearsal report is ${ageDays.toFixed(1)} days old; maximum is ${maxAgeDays}.`);
  }

  const sqlFailures = Array.isArray(report.result?.failed) ? report.result.failed : null;
  const authFailures = Array.isArray(report.result?.authFailed) ? report.result.authFailed : null;
  if (!sqlFailures || !authFailures) fail('report does not contain executor failure arrays.');
  if (sqlFailures?.length) fail(`${sqlFailures.length} SQL operation(s) failed during rehearsal.`);
  if (authFailures?.length) fail(`${authFailures.length} Auth operation(s) failed during rehearsal.`);

  const unverifiedSheets = report.plan?.unverifiedSheets;
  if (!Array.isArray(unverifiedSheets)) fail('report.plan.unverifiedSheets is missing.');
  if (unverifiedSheets?.length) fail(`${unverifiedSheets.length} sheet mapping(s) remain unverified.`);

  const attachmentSummary = report.plan?.attachmentCandidates;
  const attachmentCount = Number(attachmentSummary?.registryCandidates) + Number(attachmentSummary?.directCandidates);
  if (!attachmentSummary || !Number.isInteger(attachmentCount) || attachmentCount < 0) {
    fail('report.plan.attachmentCandidates is missing or invalid.');
  } else if (attachmentSummary.locatorsIncluded !== false) {
    fail('rehearsal report must not contain access-bearing attachment locators.');
  } else if (Number(attachmentSummary.unresolvedRegistryRows) > 0) {
    fail(`${attachmentSummary.unresolvedRegistryRows} attachment registry row(s) have no source locator.`);
  } else if (attachmentCount > 0) {
    if (!attachmentsApproved) fail(`${attachmentCount} attachment candidate(s) require explicit MIGRATION_ATTACHMENTS_APPROVED=true.`);
    const attachments = await readJsonIfPresent(attachmentReportPath);
    if (!attachments.present) {
      fail(`cannot validate attachment report at ${attachmentReportPath}: ${attachments.error instanceof Error ? attachments.error.message : attachments.error}`);
    } else {
      const attachmentReport = attachments.value;
      const sourceCandidates = Number(attachmentReport.sourceCandidates);
      const uploaded = Number(attachmentReport.uploaded);
      const archived = Number(attachmentReport.archived);
      const unresolved = Number(attachmentReport.unresolved);
      const checksumsVerified = Number(attachmentReport.checksumsVerified);
      if (attachmentReport.locatorsIncluded !== false) fail('attachment report must not contain source locators.');
      if (sourceCandidates !== attachmentCount) fail('attachment report candidate count does not match rehearsal.');
      if (unresolved !== 0) fail(`${unresolved} attachment(s) remain unresolved.`);
      if (uploaded + archived !== sourceCandidates) fail('uploaded + archived attachments do not reconcile to source candidates.');
      if (checksumsVerified !== uploaded) fail('every uploaded attachment must have a verified checksum.');
    }
  }

  if (!process.exitCode) {
    console.log(`Migration gate passed: report=${reportPath}; approval=${approvalRef}; generatedAt=${report.generatedAt}`);
  }
}

// ผู้รับผิดชอบต้องระบุได้เสมอ ไม่ว่าจะโหมดไหน
if (approvalRef.length < 5) fail('MIGRATION_APPROVAL_REF must identify the owner approval/change ticket.');

if (!MODES.includes(mode)) {
  fail(`MIGRATION_MODE must be one of ${MODES.join(' | ')}; received "${mode}".`);
} else if (mode === 'fresh-start') {
  await checkFreshStart();
} else {
  await checkLegacyImport();
}
