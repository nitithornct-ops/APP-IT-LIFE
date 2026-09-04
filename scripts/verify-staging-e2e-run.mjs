/**
 * ด่านนี้พิสูจน์ว่า commit ที่กำลังจะขึ้น Production ผ่าน Staging Live E2E มาแล้วจริง
 *
 *   verified (ค่าเริ่มต้น) — ต้องอ้างอิง run ของ staging-e2e.yml ที่ success บน master ด้วย SHA เดียวกัน
 *
 *   deferred — ใช้เมื่อ staging ยังตั้งค่าไม่เสร็จจน E2E รันไม่ได้เลย ตามแนวเดียวกับโหมด fresh-start
 *     ของ migration gate: ไม่ปิดประตูและไม่ปลอมหลักฐาน แต่เปลี่ยนเป็นบังคับให้มีคนพิมพ์คำประกาศ
 *     และมีเลขอนุมัติกำกับ เพื่อให้ย้อนตรวจได้ว่าใครสั่งข้ามและอ้างอิงเอกสารใด
 *     (เพิ่ม 2026-09-04 ตามการตัดสินใจของเจ้าของงานว่ายังไม่ต้องทำ UAT ในรอบนี้)
 */
const reference = process.env.STAGING_E2E_RUN_REF?.trim() ?? '';
const token = process.env.GITHUB_TOKEN?.trim() ?? '';
const repository = process.env.GITHUB_REPOSITORY?.trim() ?? '';
const expectedSha = process.env.GITHUB_SHA?.trim() ?? '';
const apiUrl = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
const serverUrl = (process.env.GITHUB_SERVER_URL ?? 'https://github.com').replace(/\/$/, '');
const maxAgeHours = Number(process.env.STAGING_E2E_MAX_AGE_HOURS ?? '72');
const mode = (process.env.STAGING_E2E_MODE ?? 'verified').trim();
const approvalRef = process.env.MIGRATION_APPROVAL_REF?.trim() ?? '';

/** คำที่ต้องพิมพ์เพื่อรับว่ารุ่นนี้ขึ้น Production โดยไม่มีหลักฐาน E2E — ยาวพอที่จะไม่ถูกกดผ่านโดยไม่ได้อ่าน */
const DEFER_PHRASE = 'NO-STAGING-EVIDENCE';
const MODES = ['verified', 'deferred'];

function fail(message) {
  console.error(`Staging E2E gate failed: ${message}`);
  process.exit(1);
}

if (!MODES.includes(mode)) {
  fail(`STAGING_E2E_MODE must be one of ${MODES.join(' | ')}; received "${mode}".`);
}

if (mode === 'deferred') {
  if (process.env.STAGING_E2E_DEFER_CONFIRM?.trim() !== DEFER_PHRASE) {
    fail(`deferred mode requires STAGING_E2E_DEFER_CONFIRM=${DEFER_PHRASE} to accept a release with no staging evidence.`);
  }
  // ผู้รับผิดชอบต้องระบุได้เสมอ เหมือนที่ migration gate บังคับไว้ทุกโหมด
  if (approvalRef.length < 5) {
    fail('MIGRATION_APPROVAL_REF must identify the owner approval/change ticket that authorised the deferral.');
  }
  console.log(`::warning title=Staging E2E deferred::${expectedSha} ships without Staging Live E2E evidence; approval=${approvalRef}`);
  console.log(`Staging E2E gate passed (deferred): no evidence required; approval=${approvalRef}; declared=${DEFER_PHRASE}`);
  process.exit(0);
}

if (!reference || !token || !repository || !expectedSha) {
  fail('STAGING_E2E_RUN_REF, GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA are required.');
}

let runId = reference;
if (!/^\d+$/.test(reference)) {
  let parsed;
  try {
    parsed = new URL(reference);
  } catch {
    fail('reference must be a GitHub Actions run URL or numeric run ID.');
  }
  const expectedOrigin = new URL(serverUrl).origin;
  if (parsed.origin !== expectedOrigin) fail(`run URL must use ${expectedOrigin}.`);
  const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = parsed.pathname.match(new RegExp(`^/${escapedRepository}/actions/runs/(\\d+)/?$`));
  if (!match) fail(`run URL must belong to ${repository} and point to /actions/runs/<id>.`);
  runId = match[1];
}

const response = await fetch(`${apiUrl}/repos/${repository}/actions/runs/${runId}`, {
  headers: {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  },
});
if (!response.ok) fail(`GitHub API returned ${response.status} while reading run ${runId}.`);

const run = await response.json();
if (run.path !== '.github/workflows/staging-e2e.yml') {
  fail(`run ${runId} belongs to ${run.path ?? 'an unknown workflow'}, not staging-e2e.yml.`);
}
if (run.status !== 'completed' || run.conclusion !== 'success') {
  fail(`run ${runId} is ${run.status}/${run.conclusion ?? 'no conclusion'}, not completed/success.`);
}
if (run.head_sha !== expectedSha) {
  fail(`run ${runId} tested ${run.head_sha}, but this production release is ${expectedSha}.`);
}
if (run.head_branch !== 'master') {
  fail(`run ${runId} tested branch ${run.head_branch ?? 'unknown'}, not master.`);
}

const completedAt = Date.parse(run.updated_at);
const ageHours = (Date.now() - completedAt) / 3_600_000;
if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > maxAgeHours) {
  fail(`run ${runId} is ${Number.isFinite(ageHours) ? ageHours.toFixed(1) : 'unknown'} hours old; maximum is ${maxAgeHours}.`);
}

console.log(`Staging E2E gate passed: ${run.html_url}; sha=${run.head_sha}; age=${ageHours.toFixed(1)}h`);
