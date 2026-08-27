// Runtime gate: proves the target Supabase project actually matches the code before deploying.
//
// A partially-applied migration set is invisible to typecheck/lint/unit tests — every one of them
// passes while `GET /api/v1/tickets` returns 400 because a column the route selects does not exist.
// This gate closes that gap by querying the live project for (a) every table the migrations create,
// (b) the columns route handlers select by name, and (c) the Auth settings that must be locked down.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Locally these are read from apps/api/.dev.vars when not already set, so nobody has to paste a
// service role key into a shell (where it would land in the terminal history). CI sets real env
// vars and .dev.vars does not exist there, so the fallback is a no-op on the deploy runner.
// Run: npm run runtime:gate

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Fill in any missing Supabase credential from the local, git-ignored .dev.vars file. */
async function loadLocalDevVars() {
  const wanted = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  if (wanted.every((name) => process.env[name]?.trim())) return;

  let contents;
  try {
    contents = await readFile(resolve('apps/api/.dev.vars'), 'utf8');
  } catch {
    return; // ไม่มีไฟล์ (เช่นบน CI) — ใช้ค่าจาก environment ตามปกติ
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (!wanted.includes(name) || process.env[name]?.trim()) continue;
    process.env[name] = rawValue.trim().replace(/^["'](.*)["']$/, '$1');
  }
}

await loadLocalDevVars();

const url = process.env.SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
const allowOpenSignup = process.env.ALLOW_PUBLIC_SIGNUP === 'true';

const failures = [];
function fail(message) {
  failures.push(message);
}

if (!url || !serviceKey || !anonKey) {
  console.error('Runtime gate failed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required.');
  process.exit(1);
}

const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

/** Ask PostgREST for one row; a 200 proves the table and every listed column exist. */
async function probe(table, columns = 'id') {
  const response = await fetch(`${url}/rest/v1/${table}?select=${encodeURIComponent(columns)}&limit=1`, {
    headers: adminHeaders,
  });
  if (response.status === 200) return { ok: true };
  const body = await response.text();
  let message = body.slice(0, 200);
  try {
    message = JSON.parse(body).message ?? message;
  } catch {
    /* keep the raw text */
  }
  return { ok: false, status: response.status, message };
}

// ---------------------------------------------------------------------------
// 1. Every table the migrations create must exist in the project.
// ---------------------------------------------------------------------------
const migrationDir = resolve('supabase/migrations');
const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
const tables = new Set();
for (const file of files) {
  const sql = await readFile(resolve(migrationDir, file), 'utf8');
  for (const match of sql.matchAll(/^create table (?:if not exists )?public\.([a-z0-9_]+)/gim)) {
    tables.add(match[1]);
  }
}

const missingTables = [];
for (const table of [...tables].sort()) {
  const result = await probe(table, '*');
  if (!result.ok) missingTables.push(`${table} (${result.status}: ${result.message})`);
}
if (missingTables.length) {
  fail(`${missingTables.length} table(s) defined in migrations are missing from the project:\n    - ${missingTables.join('\n    - ')}`);
}

// ---------------------------------------------------------------------------
// 2. Columns that route handlers select by name. Add an entry whenever a route
//    starts depending on a new column, so a half-applied migration fails here
//    instead of in production.
// ---------------------------------------------------------------------------
const REQUIRED_COLUMNS = {
  tickets: [
    'ticket_no', 'title', 'requester_id', 'requester_name_snapshot', 'department_name_snapshot',
    'guest_name', 'guest_department', 'source_channel', 'public_tracking_token_hash',
    'requester_line_user_id', 'category_id', 'priority', 'status', 'assignee_id',
    'assignee_name_snapshot', 'is_security', 'incident_id', 'due_at', 'outsource_name',
    'response_sla_hours', 'resolution_sla_hours', 'response_due_at', 'form_checkmarks',
  ],
  ticket_categories: ['name', 'default_priority', 'response_sla_hours', 'resolution_sla_hours', 'sla_hours', 'is_security_default'],
  ticket_worklogs: ['ticket_id', 'action', 'status_to', 'detail', 'is_public', 'actor_label'],
  profiles: ['email', 'full_name', 'status', 'department_id', 'position_id', 'supervisor_id'],
  employees: ['employee_code', 'first_name_th', 'last_name_th', 'email', 'status'],
  assets: ['asset_code', 'name', 'status', 'warranty_expire'],
  personal_tasks: ['title', 'status', 'priority', 'due_date', 'recurrence_rule'],
  file_attachments: ['storage_path', 'original_filename', 'mime_type', 'size_bytes', 'module', 'target_table', 'target_id'],
  login_logs: ['user_id', 'email_attempted', 'success', 'failure_reason', 'ip_address', 'user_agent'],
  audit_logs: ['actor_id', 'actor_email', 'action', 'module', 'target_table', 'target_id', 'detail', 'result', 'request_id'],
  system_settings: ['key', 'value', 'group_key', 'is_editable', 'support_status', 'sort_order'],
  line_users: ['link_status'],
  line_sessions: ['session_hash', 'line_user_id', 'expires_at'],
  incidents: ['incident_number', 'severity', 'status', 'contains_personal_data', 'dpo_notify_deadline'],
  service_requests: ['service_code', 'service_name', 'status', 'approval_status', 'due_at'],
};

for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
  const result = await probe(table, columns.join(','));
  if (!result.ok) fail(`table "${table}" is missing a required column (${result.status}: ${result.message})`);
}

// ---------------------------------------------------------------------------
// 3. Settings rows the API reads by key and treats as mandatory.
// ---------------------------------------------------------------------------
const settingsResponse = await fetch(
  `${url}/rest/v1/system_settings?select=key&key=in.(ORG_NAME,ORG_LOGO_URL,SLA_BUSINESS_START,SLA_BUSINESS_END,SLA_BUSINESS_DAYS)`,
  { headers: adminHeaders },
);
const settingsRows = settingsResponse.status === 200 ? await settingsResponse.json() : [];
const presentKeys = new Set(settingsRows.map((row) => row.key));
for (const key of ['ORG_NAME', 'ORG_LOGO_URL', 'SLA_BUSINESS_START', 'SLA_BUSINESS_END', 'SLA_BUSINESS_DAYS']) {
  if (!presentKeys.has(key)) fail(`system_settings row "${key}" is missing; a settings migration has not been applied.`);
}

// ---------------------------------------------------------------------------
// 3b. RPC functions route handlers call by name. A missing function fails at request time,
//     not at build time, so it has to be proven here.
// ---------------------------------------------------------------------------
for (const [fn, body] of [
  ['my_profile', {}],
  ['my_roles', {}],
  ['my_permissions', {}],
  ['has_permission', { permission_key_input: 'dashboard.view' }],
  ['update_my_profile', { full_name_input: null, phone_input: null }],
  ['record_inventory_transaction', {
    item_id_input: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    transaction_type_input: 'IN',
    qty_input: 1,
    notes_input: null,
    actor_id_input: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    actor_email_input: 'runtime-gate@invalid.local',
    request_id_input: 'runtime-gate',
  }],
  ['adjust_inventory_stock', {
    item_id_input: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    counted_input: 0,
    notes_input: null,
    actor_id_input: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    actor_email_input: 'runtime-gate@invalid.local',
    request_id_input: 'runtime-gate',
  }],
  ['deactivate_user_access', {
    user_id_input: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    actor_id_input: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    actor_email_input: 'runtime-gate@invalid.local',
    reason_input: 'runtime-gate probe',
    request_id_input: 'runtime-gate',
  }],
  // แหล่งข้อมูลจริงของการตรวจสุขภาพระบบใน Governance — ถ้าไม่มี ปุ่มตรวจจะบันทึกผล FAIL ทุกครั้ง
  ['governance_health_snapshot', {}],
]) {
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 404) {
    // A real RPC may deliberately raise SQLSTATE P0002 for the non-existent probe ID,
    // which PostgREST also maps to 404. Only its own schema-cache error means the
    // migration/function is missing.
    const responseBody = await response.text();
    let errorCode = '';
    try {
      errorCode = String(JSON.parse(responseBody).code ?? '');
    } catch {
      /* a non-PostgREST 404 is handled conservatively below */
    }
    if (!errorCode || errorCode.startsWith('PGRST')) {
      fail(`database function public.${fn}() is missing; a migration has not been applied.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Auth configuration. Public sign-up hands an `authenticated` JWT — and every
//    RLS policy written `to authenticated` — to anyone on the internet.
// ---------------------------------------------------------------------------
const authResponse = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
if (authResponse.status !== 200) {
  fail(`cannot read Auth settings (HTTP ${authResponse.status}).`);
} else {
  const settings = await authResponse.json();
  if (settings.disable_signup !== true && !allowOpenSignup) {
    fail('Supabase Auth still allows public sign-up; disable it (or set ALLOW_PUBLIC_SIGNUP=true to override deliberately).');
  }
  if (settings.external?.anonymous_users === true) {
    fail('Supabase Auth allows anonymous users; disable anonymous sign-ins.');
  }
  if (settings.mailer_autoconfirm === true) {
    fail('Supabase Auth auto-confirms email addresses; require confirmation in production.');
  }
}

// ---------------------------------------------------------------------------
if (failures.length) {
  for (const message of failures) console.error(`Runtime gate failed: ${message}`);
  process.exit(1);
}

console.log(
  `Runtime gate passed: ${tables.size} table(s) present, ` +
  `${Object.values(REQUIRED_COLUMNS).flat().length} required column(s) verified, Auth locked down. ` +
  'No secret values were printed.',
);
