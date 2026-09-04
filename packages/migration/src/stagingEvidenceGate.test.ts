import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const stagingGate = join(repositoryRoot, 'scripts', 'verify-staging-e2e-run.mjs');
const predeployScript = join(repositoryRoot, 'scripts', 'predeploy.mjs');
const temporaryDirectories: string[] = [];

/**
 * ทุกตัวแปรที่สองสคริปต์นี้อ่าน — ต้องล้างออกจาก env ที่สืบทอดมาเสมอ ด้วยเหตุผลเดียวกับ
 * deploymentGate.test.ts: งาน Deploy Production ตั้งค่าเหล่านี้ไว้ระดับ job ค่าจึงรั่วเข้าเทสต์
 * แล้วเคสที่ควรถูกบล็อกจะกลับผ่านเฉพาะตอนรันบน CI ของงาน deploy ซึ่งเป็นที่ที่สายเกินจะรู้
 */
const GATE_ENV_KEYS = [
  'STAGING_E2E_MODE',
  'STAGING_E2E_DEFER_CONFIRM',
  'STAGING_E2E_RUN_REF',
  'STAGING_E2E_APPROVAL_REF',
  'STAGING_E2E_MAX_AGE_HOURS',
  'MIGRATION_APPROVAL_REF',
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  'GITHUB_SHA',
  'WEB_HEADERS_FILE',
  'PRODUCTION_DEPLOY_CONFIRM',
  'PRODUCTION_WEB_URL',
  'PRODUCTION_API_URL',
  'LINE_LOGIN_ENABLED',
  'NOTIFY_LINE_ENABLED',
];

function gateEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const base = { ...process.env };
  for (const key of GATE_ENV_KEYS) delete base[key];
  return { ...base, ...overrides };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * โหมด deferred ปล่อยรุ่นขึ้น Production โดยไม่มีหลักฐาน E2E ได้ — ซึ่งเป็นสิ่งที่อันตรายพอจะต้อง
 * พิสูจน์ว่ามันยังบล็อกทุกทางลัด ไม่ใช่กลายเป็นสวิตช์ปิดด่านที่ใครกดก็ผ่าน
 */
describe('staging E2E gate — deferred mode', () => {
  function runGate(env: Record<string, string>) {
    return spawnSync(process.execPath, [stagingGate], { encoding: 'utf8', env: gateEnv(env) });
  }

  it('passes when the owner declares the deferral and names an approval', () => {
    const result = runGate({
      STAGING_E2E_MODE: 'deferred',
      STAGING_E2E_DEFER_CONFIRM: 'NO-STAGING-EVIDENCE',
      MIGRATION_APPROVAL_REF: 'CHG-1234',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Staging E2E gate passed (deferred)');
    expect(result.stdout).toContain('::warning');
  });

  it('blocks when nobody typed the declaration', () => {
    const result = runGate({ STAGING_E2E_MODE: 'deferred', MIGRATION_APPROVAL_REF: 'CHG-1234' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STAGING_E2E_DEFER_CONFIRM');
  });

  it('blocks a near-miss declaration rather than accepting anything truthy', () => {
    const result = runGate({
      STAGING_E2E_MODE: 'deferred',
      STAGING_E2E_DEFER_CONFIRM: 'yes',
      MIGRATION_APPROVAL_REF: 'CHG-1234',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STAGING_E2E_DEFER_CONFIRM');
  });

  it('still requires an owner approval reference to record who deferred', () => {
    const result = runGate({ STAGING_E2E_MODE: 'deferred', STAGING_E2E_DEFER_CONFIRM: 'NO-STAGING-EVIDENCE' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MIGRATION_APPROVAL_REF');
  });

  it('rejects an unknown mode instead of silently falling back', () => {
    const result = runGate({ STAGING_E2E_MODE: 'skip', MIGRATION_APPROVAL_REF: 'CHG-1234' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STAGING_E2E_MODE must be one of');
  });

  /** ค่าเริ่มต้นต้องเป็นการตรวจหลักฐานจริงเสมอ ไม่ใช่โหมดผ่อนผัน */
  it('defaults to verified and still demands a run reference', () => {
    const result = runGate({ MIGRATION_APPROVAL_REF: 'CHG-1234' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STAGING_E2E_RUN_REF');
  });
});

/**
 * predeploy เคยบังคับ STAGING_E2E_APPROVAL_REF เสมอ รุ่นที่ผ่านด่าน E2E แบบ deferred มาแล้วจึงมา
 * ตายตรงนี้แทน — เทสต์ชุดนี้ตรึงไว้ว่าสองด่านต้องยอมรับหลักฐานชุดเดียวกัน
 */
describe('predeploy — staging evidence and CSP origin', () => {
  async function headersFile(apiOrigin: string) {
    const directory = await mkdtemp(join(tmpdir(), 'itlife-predeploy-'));
    temporaryDirectories.push(directory);
    const path = join(directory, '_headers');
    await writeFile(path, [
      '/*',
      '  X-Content-Type-Options: nosniff',
      `  Content-Security-Policy: default-src 'self'; connect-src 'self' ${apiOrigin} https://*.supabase.co; upgrade-insecure-requests`,
      '',
    ].join('\n'));
    return path;
  }

  const productionApi = 'https://itlife-api-production.example.workers.dev';

  function baseEnv(overrides: Record<string, string>): Record<string, string> {
    return {
      PRODUCTION_DEPLOY_CONFIRM: 'DEPLOY',
      PRODUCTION_WEB_URL: 'https://life-it.pages.dev',
      PRODUCTION_API_URL: productionApi,
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      SUPABASE_DB_URL: 'postgresql://example',
      VITE_TURNSTILE_SITE_KEY: '0x4AAAAAAAexample',
      TURNSTILE_SECRET: 'secret',
      TURNSTILE_HOSTNAMES: 'life-it.pages.dev',
      ALLOWED_ORIGINS: 'https://life-it.pages.dev',
      PUBLIC_APP_URL: 'https://life-it.pages.dev',
      CLOUDFLARE_API_TOKEN: 'token',
      CLOUDFLARE_ACCOUNT_ID: 'account',
      CLOUDFLARE_PAGES_PROJECT: 'life-it',
      MIGRATION_APPROVAL_REF: 'CHG-1234',
      ...overrides,
    };
  }

  function runPredeploy(env: Record<string, string>) {
    return spawnSync(process.execPath, [predeployScript], { encoding: 'utf8', env: gateEnv(baseEnv(env)) });
  }

  it('accepts the deferral declaration in place of a run reference', async () => {
    const result = runPredeploy({
      WEB_HEADERS_FILE: await headersFile(productionApi),
      STAGING_E2E_MODE: 'deferred',
      STAGING_E2E_DEFER_CONFIRM: 'NO-STAGING-EVIDENCE',
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('blocks deferred mode when the declaration is missing', async () => {
    const result = runPredeploy({
      WEB_HEADERS_FILE: await headersFile(productionApi),
      STAGING_E2E_MODE: 'deferred',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STAGING_E2E_DEFER_CONFIRM');
  });

  it('still requires a run reference in the default verified mode', async () => {
    const result = runPredeploy({ WEB_HEADERS_FILE: await headersFile(productionApi) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STAGING_E2E_APPROVAL_REF is required');
  });

  /**
   * CSP ระบุ origin ของ API ไว้ตายตัว ถ้าย้ายโดเมนแล้วลืมแก้ไฟล์ _headers ทุกด่านจะยังเขียว
   * เพราะ health check ยิงตรงไปที่ Worker — มีแต่เบราว์เซอร์ของผู้ใช้จริงเท่านั้นที่ถูกบล็อก
   */
  it('blocks when connect-src does not list the configured API origin', async () => {
    const result = runPredeploy({
      WEB_HEADERS_FILE: await headersFile('https://old-api.example.workers.dev'),
      STAGING_E2E_APPROVAL_REF: 'https://github.com/example/repo/actions/runs/1',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('connect-src');
  });

  it('reports a missing headers file instead of skipping the check', () => {
    const result = runPredeploy({
      WEB_HEADERS_FILE: join(tmpdir(), 'itlife-missing-headers'),
      STAGING_E2E_APPROVAL_REF: 'https://github.com/example/repo/actions/runs/1',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cannot read');
  });
});
