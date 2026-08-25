import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLiveAccessToken, installLiveSession } from './helpers/liveAuth';

test.skip(process.env.LIVE_E2E !== '1', 'Live Governance E2E is opt-in');
test.describe.configure({ mode: 'serial' });

const apiBase = 'http://localhost:8787/api/v1';
const runId = Date.now();
const password = `Live19!${runId}Aa`;
const emails = {
  admin: `codex-m19-${runId}-admin@example.com`,
  dpo: `codex-m19-${runId}-dpo@example.com`,
  auditor: `codex-m19-${runId}-auditor@example.com`,
  user: `codex-m19-${runId}-user@example.com`,
};
const userIds: string[] = [];
const created: Record<string, string> = {};
let service: SupabaseClient;

function parseEnv(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !line.trimStart().startsWith('#') && line.includes('=')).map((line) => {
    const index = line.indexOf('='); return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}

async function createUser(email: string, role: string, name: string) {
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !data.user) throw error ?? new Error('create user failed');
  userIds.push(data.user.id);
  const { data: roleRow, error: roleError } = await service.from('roles').select('id').eq('key', role).single();
  if (roleError) throw roleError;
  const { error: assignError } = await service.from('user_roles').insert({ user_id: data.user.id, role_id: roleRow.id });
  if (assignError) throw assignError;
  return data.user.id;
}

async function token(email: string): Promise<string> {
  return createLiveAccessToken(email);
}

async function api<T>(accessToken: string, path: string, init?: RequestInit, expectedStatus = 200): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}`, ...init?.headers } });
  const body = await response.json() as { success: boolean; data?: T; error?: { code: string; message: string } };
  expect(response.status, body.error?.message).toBe(expectedStatus);
  if (!body.success || body.data === undefined) throw new Error(`${body.error?.code}: ${body.error?.message}`);
  return body.data;
}

async function login(page: Page, email: string) {
  await installLiveSession(page, email);
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

async function logout(context: BrowserContext) { await context.clearCookies(); await context.clearPermissions(); }

test.beforeAll(async () => {
  const vars = parseEnv(resolve(process.cwd(), '../api/.dev.vars'));
  service = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await createUser(emails.admin, 'it_admin', 'Module 19 Admin');
  await createUser(emails.dpo, 'dpo', 'Module 19 DPO');
  await createUser(emails.auditor, 'auditor', 'Module 19 Auditor');
  await createUser(emails.user, 'user', 'Module 19 User');
});

test.afterAll(async () => {
  if (!service) return;
  const tables = [
    'data_destruction_requests','audit_findings','compliance_corrective_actions','compliance_assessments','compliance_obligations',
    'governance_evidence_items','privacy_consents','privacy_dsr','policy_acknowledgements','governance_training_records',
    'audit_engagements','legal_register','privacy_ropa','governance_risks','governance_ai_tools','governance_cloud_services',
    'governance_training_plans','governance_documents','employee_lifecycle_events','record_links','integration_outbox',
    'governance_data_assets','governance_operational_checks','governance_retention_runs',
  ];
  for (const table of tables) {
    if (table === 'governance_retention_runs') {
      await service.from(table).delete().in('requested_by_id', userIds);
    } else if (table === 'governance_operational_checks') {
      await service.from(table).delete().in('checked_by_id', userIds);
    } else {
      await service.from(table).delete().in('created_by', userIds);
    }
  }
  await service.from('audit_logs').delete().in('actor_id', userIds);
  await service.from('login_logs').delete().in('user_id', userIds);
  for (const id of userIds.reverse()) await service.auth.admin.deleteUser(id);
});

test('live API covers all active Governance surfaces, workflows and RBAC', async () => {
  // This flow exercises every governance domain against remote staging. On CI
  // it can exceed Playwright's 30s default; cleanup must not start while the
  // final verification request is still in flight.
  test.setTimeout(90_000);
  const adminToken = await token(emails.admin); const dpoToken = await token(emails.dpo);
  const auditorToken = await token(emails.auditor); const userToken = await token(emails.user);
  const domains = ['data-classification','compliance','privacy','risk','ai-cloud','awareness','evidence','audit-management','documents','operations','integrations'];
  for (const domain of domains) {
    const result = await api<{ domain: string; records: unknown[] }>(adminToken, `/governance/${domain}`);
    expect(result.domain).toBe(domain); expect(Array.isArray(result.records)).toBe(true);
  }

  const asset = await api<{ id: string }>(adminToken, '/governance/data-classification/data-assets', { method: 'POST', body: JSON.stringify({ dataName: `LIVE19 Customer Export ${runId}`, systemName: 'CRM', classification: 'ลับมาก', dataOwner: emails.dpo, retentionDays: 365, containsPersonalData: true, status: 'ใช้งาน', notes: 'Live E2E' }) }, 201);
  created.asset = asset.id;
  const destruction = await api<{ id: string }>(adminToken, `/governance/data-classification/data-assets/${asset.id}/actions/request-destruction`, { method: 'POST', body: '{}' }, 201);
  created.destruction = destruction.id;
  await api(adminToken, `/governance/data-classification/destruction-requests/${destruction.id}/actions/approve`, { method: 'POST', body: '{}' });
  await api(adminToken, `/governance/data-classification/destruction-requests/${destruction.id}/actions/confirm-destroyed`, { method: 'POST', body: JSON.stringify({ method: 'Secure erase E2E', evidenceUrl: 'https://example.com/evidence/live19' }) });

  const risk = await api<{ id: string; score: number }>(adminToken, '/governance/risk/risks', { method: 'POST', body: JSON.stringify({ title: `LIVE19 Cloud outage ${runId}`, category: 'เทคโนโลยี/ระบบ', owner: emails.admin, likelihood: 4, impact: 5, treatment: 'ลดความเสี่ยง (Mitigate)', treatmentPlan: 'Multi-region recovery', status: 'เปิด', notes: 'Live E2E' }) }, 201);
  created.risk = risk.id; expect(risk.score).toBe(20);

  const ropa = await api<{ id: string }>(dpoToken, '/governance/privacy/ropa', { method: 'POST', body: JSON.stringify({ processName: `LIVE19 Employee Records ${runId}`, department: 'HR', purpose: 'Employee administration', lawfulBasis: 'หน้าที่ตามกฎหมาย', status: 'ใช้งาน', notes: 'Live E2E' }) }, 201);
  created.ropa = ropa.id;

  const audit = await api<{ id: string }>(adminToken, '/governance/audit-management/audits', { method: 'POST', body: JSON.stringify({ title: `LIVE19 Audit ${runId}`, scope: 'Governance controls', leadAuditor: emails.auditor, status: 'เปิด', notes: 'Live E2E' }) }, 201);
  created.audit = audit.id;
  const finding = await api<{ id: string }>(adminToken, '/governance/audit-management/findings', { method: 'POST', body: JSON.stringify({ auditId: audit.id, title: `LIVE19 Finding ${runId}`, owner: emails.admin, status: 'รอตรวจยืนยัน', evidence: 'Live evidence', actionPlan: 'Close independently', notes: 'Live E2E' }) }, 201);
  created.finding = finding.id;
  await api(adminToken, `/governance/audit-management/findings/${finding.id}/actions/verify`, { method: 'POST', body: '{}' }, 409).catch((error: Error) => expect(error.message).toContain('SEGREGATION_OF_DUTIES'));
  const verified = await api<{ status: string }>(auditorToken, `/governance/audit-management/findings/${finding.id}/actions/verify`, { method: 'POST', body: JSON.stringify({ evidenceUrl: 'https://example.com/evidence/audit-live19' }) });
  expect(verified.status).toBe('ปิด');

  const document = await api<{ id: string }>(adminToken, '/governance/documents/documents', { method: 'POST', body: JSON.stringify({ documentCode: `LIVE19-${runId}`, title: `LIVE19 Information Security Policy ${runId}`, version: '1.0', documentUrl: 'https://example.com/policy/live19.pdf', status: 'ใช้งาน', notes: 'Designer deferred post Go-live' }) }, 201);
  created.document = document.id;
  const forbidden = await fetch(`${apiBase}/governance/ai-cloud/ai-tools`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${userToken}` }, body: JSON.stringify({ toolName: 'Forbidden AI', prohibitedDataTypes: 'Confidential' }) });
  expect(forbidden.status).toBe(403);
  const evidenceExport = await api<{ csv: string }>(auditorToken, '/governance/evidence/exports/csv', { method: 'POST' });
  expect(evidenceExport.csv).toContain('CTL-LEGAL-01');

  const operations = await api<{ records: Array<{ id: string; entity: string }> }>(adminToken, '/governance/operations');
  const retentionEntry = operations.records.find((record) => record.entity === 'retention-runs');
  const healthEntry = operations.records.find((record) => record.entity === 'operational-checks');
  expect(retentionEntry && healthEntry).toBeTruthy();
  await api(adminToken, `/governance/operations/retention-runs/${retentionEntry!.id}/actions/retention-preview`, { method: 'POST', body: '{}' });
  await api(adminToken, `/governance/operations/operational-checks/${healthEntry!.id}/actions/health-check`, { method: 'POST', body: '{}' });
});

test('admin UI renders all sections and creates a high risk record', async ({ page }) => {
  await login(page, emails.admin);
  await page.goto('/governance');
  await expect(page.getByRole('heading', { name: 'Governance, Risk & Compliance Center' })).toBeVisible({ timeout: 20_000 });
  for (const tab of ['ข้อมูล','กฎหมาย','PDPA','ความเสี่ยง','AI/Cloud','อบรม','หลักฐาน','Audit','เอกสาร','Hardening','Outbox']) await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ความเสี่ยง', exact: true }).click();
  await expect(page.getByText(`LIVE19 Cloud outage ${runId}`, { exact: true })).toBeVisible();
  await expect(page.getByText('Score 20', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/module19-governance-admin.png', fullPage: true });
  await page.getByRole('button', { name: 'เอกสาร', exact: true }).click();
  await expect(page.getByText('Field Designer และ PDF Designer แบบลากวางถูกเลื่อนไปหลัง Go-live ตามมติ Owner; metadata, CSV export และโครงสร้างรองรับ template version ยังคงอยู่ครบ', { exact: true })).toBeVisible();
});

test('regular user sees only AI/Awareness and can e-sign policy', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  await login(page, emails.user); await page.goto('/governance');
  await expect(page.getByRole('heading', { name: 'Governance, Risk & Compliance Center' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'AI/Cloud', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'อบรม', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDPA', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'อบรม', exact: true }).click();
  await page.getByRole('button', { name: 'ลงชื่อรับทราบนโยบาย', exact: true }).click();
  await page.getByLabel('ชื่อนโยบาย', { exact: true }).fill(`LIVE19 Acceptable Use ${runId}`);
  await page.getByLabel('เวอร์ชัน', { exact: true }).fill('1.0');
  await page.getByLabel('ชื่อสำหรับ e-sign', { exact: true }).fill('Module 19 User');
  await page.getByLabel('ยืนยันว่าอ่านและรับทราบแล้ว', { exact: true }).check();
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByText(`LIVE19 Acceptable Use ${runId}`, { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/module19-governance-user.png', fullPage: true });
  await logout(context); await context.close();
});
