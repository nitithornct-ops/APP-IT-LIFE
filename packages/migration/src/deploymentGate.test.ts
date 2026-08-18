import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const gateScript = join(repositoryRoot, 'scripts', 'check-migration-gate.mjs');
const temporaryDirectories: string[] = [];

/**
 * ตัวแปรทุกตัวที่ scripts/check-migration-gate.mjs อ่าน — ต้องล้างออกจาก env ที่สืบทอดมาก่อนเสมอ
 *
 * เทสต์ชุดนี้เคยส่ง { ...process.env } เข้าไปตรง ๆ จึงไม่ได้ทดสอบสิ่งที่ตั้งใจเมื่อกระบวนการที่เรียกมัน
 * ตั้งตัวแปรเหล่านี้ไว้อยู่แล้ว — งาน Deploy Production ตั้ง MIGRATION_MODE และ FRESH_START_CONFIRM
 * ไว้ระดับ job ค่าจึงรั่วเข้าเทสต์ ทำให้เคสที่ควรถูกบล็อกกลับผ่าน และเคสที่ควรผ่านกลับถูกบล็อก
 * (ล้มจริงตอนกด deploy ครั้งแรก 2026-08-18 — ผ่านทั้งในเครื่องและใน PR Checks เพราะที่นั่นไม่มีค่าเหล่านี้)
 */
const GATE_ENV_KEYS = [
  'MIGRATION_MODE',
  'MIGRATION_APPROVAL_REF',
  'FRESH_START_CONFIRM',
  'MIGRATION_ATTACHMENTS_APPROVED',
  'MIGRATION_REHEARSAL_REPORT',
  'MIGRATION_ATTACHMENT_REPORT',
  'MIGRATION_REPORT_MAX_AGE_DAYS',
];

/** env ที่สะอาด — มีเฉพาะค่าที่เคสนั้นตั้งเอง ไม่มีอะไรรั่วมาจากภายนอก */
function gateEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const base = { ...process.env };
  for (const key of GATE_ENV_KEYS) delete base[key];
  return { ...base, ...overrides };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function reportFiles(attachmentCount = 0) {
  const directory = await mkdtemp(join(tmpdir(), 'itlife-migration-gate-'));
  temporaryDirectories.push(directory);
  const rehearsal = join(directory, 'rehearsal.json');
  const attachments = join(directory, 'attachments.json');
  await writeFile(rehearsal, JSON.stringify({
    generatedAt: new Date().toISOString(),
    plan: {
      unverifiedSheets: [],
      attachmentCandidates: {
        registryCandidates: 0,
        directCandidates: attachmentCount,
        unresolvedRegistryRows: 0,
        candidates: [],
        locatorsIncluded: false,
      },
    },
    result: { failed: [], authFailed: [] },
  }));
  await writeFile(attachments, JSON.stringify({
    sourceCandidates: attachmentCount,
    uploaded: attachmentCount,
    archived: 0,
    unresolved: 0,
    checksumsVerified: attachmentCount,
    locatorsIncluded: false,
  }));
  return { rehearsal, attachments };
}

describe('production migration gate', () => {
  it('passes only with a recent reconciled rehearsal and attachment report', async () => {
    const files = await reportFiles(2);
    const result = spawnSync(process.execPath, [gateScript], {
      encoding: 'utf8',
      env: gateEnv({
        MIGRATION_REHEARSAL_REPORT: files.rehearsal,
        MIGRATION_ATTACHMENT_REPORT: files.attachments,
        MIGRATION_APPROVAL_REF: 'CHG-1234',
        MIGRATION_ATTACHMENTS_APPROVED: 'true',
      }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Migration gate passed');
  });

  it('blocks when the rehearsal report is unavailable', () => {
    const result = spawnSync(process.execPath, [gateScript], {
      encoding: 'utf8',
      env: gateEnv({
        MIGRATION_REHEARSAL_REPORT: join(tmpdir(), 'missing-itlife-rehearsal.json'),
        MIGRATION_APPROVAL_REF: 'CHG-1234',
      }),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Migration gate failed');
  });
});

/**
 * โหมด fresh-start มีไว้สำหรับรุ่นที่ไม่ยกข้อมูลจากระบบเดิมเข้ามาเลย ด่านจึงเปลี่ยนจากการตรวจ
 * "ผลการซ้อมย้าย" (ซึ่งไม่มีทางมีได้) มาเป็นการตรวจ "เจตนาที่ประกาศไว้" แต่ต้องไม่กลายเป็นทางลัด
 * ที่ใครก็กดผ่านได้ — เทสต์ชุดนี้จึงพิสูจน์ว่ายังบล็อกทุกกรณีที่หลักฐานไม่ครบ
 */
describe('production migration gate — fresh-start mode', () => {
  const missingReport = join(tmpdir(), 'missing-itlife-rehearsal.json');

  function runGate(env: Record<string, string>) {
    return spawnSync(process.execPath, [gateScript], {
      encoding: 'utf8',
      env: gateEnv({ MIGRATION_REHEARSAL_REPORT: missingReport, ...env }),
    });
  }

  it('passes when the owner declares no legacy data and names an approval', () => {
    const result = runGate({
      MIGRATION_MODE: 'fresh-start',
      MIGRATION_APPROVAL_REF: 'CHG-1234',
      FRESH_START_CONFIRM: 'NO-LEGACY-DATA',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Migration gate passed (fresh-start)');
  });

  it('blocks when nobody typed the declaration', () => {
    const result = runGate({ MIGRATION_MODE: 'fresh-start', MIGRATION_APPROVAL_REF: 'CHG-1234' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FRESH_START_CONFIRM');
  });

  it('blocks a near-miss declaration rather than accepting anything truthy', () => {
    const result = runGate({
      MIGRATION_MODE: 'fresh-start',
      MIGRATION_APPROVAL_REF: 'CHG-1234',
      FRESH_START_CONFIRM: 'yes',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FRESH_START_CONFIRM');
  });

  it('still requires an owner approval reference', () => {
    const result = runGate({ MIGRATION_MODE: 'fresh-start', FRESH_START_CONFIRM: 'NO-LEGACY-DATA' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MIGRATION_APPROVAL_REF');
  });

  /** ประกาศว่าไม่มีข้อมูลเดิม แต่มีรายงานการซ้อมย้ายวางอยู่ = ขัดกันเอง ต้องให้คนตัดสิน ไม่ใช่ให้สคริปต์เดา */
  it('blocks when a rehearsal report contradicts the declaration', async () => {
    const files = await reportFiles(0);
    const result = spawnSync(process.execPath, [gateScript], {
      encoding: 'utf8',
      env: gateEnv({
        MIGRATION_MODE: 'fresh-start',
        MIGRATION_REHEARSAL_REPORT: files.rehearsal,
        MIGRATION_APPROVAL_REF: 'CHG-1234',
        FRESH_START_CONFIRM: 'NO-LEGACY-DATA',
      }),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('contradicts the fresh-start declaration');
  });

  it('rejects an unknown mode instead of silently falling back', () => {
    const result = runGate({
      MIGRATION_MODE: 'skip',
      MIGRATION_APPROVAL_REF: 'CHG-1234',
      FRESH_START_CONFIRM: 'NO-LEGACY-DATA',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MIGRATION_MODE must be one of');
  });
});
