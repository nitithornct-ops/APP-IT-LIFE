import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const required = [
  'PRODUCTION_DEPLOY_CONFIRM',
  'PRODUCTION_WEB_URL',
  'PRODUCTION_API_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET',
  'TURNSTILE_HOSTNAMES',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'ALLOWED_ORIGINS',
  'PUBLIC_APP_URL',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_PAGES_PROJECT',
  'MIGRATION_APPROVAL_REF',
];

const errors = [];
for (const key of required) {
  if (!process.env[key]?.trim()) errors.push(`${key} is required`);
}

if (process.env.PRODUCTION_DEPLOY_CONFIRM !== 'DEPLOY') errors.push('PRODUCTION_DEPLOY_CONFIRM must equal DEPLOY');

// หลักฐาน Staging E2E รับได้สองทางเท่านั้น: อ้างอิง run จริง หรือประกาศเลื่อนตามโหมด deferred ของ
// staging:gate ถ้าที่นี่ยังบังคับเลข run เสมอ รุ่นที่ผ่านด่าน E2E มาแล้วจะมาตายตรงนี้แทน
const stagingMode = (process.env.STAGING_E2E_MODE ?? 'verified').trim();
if (stagingMode === 'deferred') {
  if (process.env.STAGING_E2E_DEFER_CONFIRM?.trim() !== 'NO-STAGING-EVIDENCE') {
    errors.push('STAGING_E2E_DEFER_CONFIRM must equal NO-STAGING-EVIDENCE when STAGING_E2E_MODE=deferred');
  }
} else if (!process.env.STAGING_E2E_APPROVAL_REF?.trim()) {
  errors.push('STAGING_E2E_APPROVAL_REF is required');
}
if (process.env.VITE_TURNSTILE_SITE_KEY && !/^0x[A-Za-z0-9_-]+$/.test(process.env.VITE_TURNSTILE_SITE_KEY)) {
  errors.push('VITE_TURNSTILE_SITE_KEY must be a valid Cloudflare Turnstile sitekey');
}

// ฝั่ง Worker ปฏิเสธคำขอทุกครั้งเมื่อ TURNSTILE_SECRET หรือ TURNSTILE_HOSTNAMES ขาด/ผิดรูป (fail closed)
// ตรวจตั้งแต่ตรงนี้ ไม่อย่างนั้น deploy จะผ่านหมดแต่ฟอร์มแจ้งซ่อมสาธารณะตอบ 403 ทุกคน
const turnstileHostnames = (process.env.TURNSTILE_HOSTNAMES ?? '')
  .split(',')
  .map((hostname) => hostname.trim().toLowerCase())
  .filter(Boolean);
if (turnstileHostnames.some((hostname) => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname))) {
  errors.push('TURNSTILE_HOSTNAMES must be bare comma-separated hostnames without scheme or path');
}
if (turnstileHostnames.some((hostname) => ['localhost', '127.0.0.1', '::1'].includes(hostname))) {
  errors.push('TURNSTILE_HOSTNAMES must not contain localhost in production');
}
if (process.env.PRODUCTION_WEB_URL) {
  try {
    const webHost = new URL(process.env.PRODUCTION_WEB_URL).hostname.toLowerCase();
    if (turnstileHostnames.length && !turnstileHostnames.includes(webHost)) {
      errors.push('TURNSTILE_HOSTNAMES must include the PRODUCTION_WEB_URL hostname that serves the widget');
    }
  } catch {
    // URL ที่ผิดรูปถูกรายงานไปแล้วโดย requireHttps
  }
}

function requireHttps(key) {
  const value = process.env[key];
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') errors.push(`${key} must use https`);
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) errors.push(`${key} must not target localhost`);
  } catch {
    errors.push(`${key} must be a valid URL`);
  }
}

for (const key of ['PRODUCTION_WEB_URL', 'PRODUCTION_API_URL', 'VITE_SUPABASE_URL', 'SUPABASE_URL', 'PUBLIC_APP_URL']) {
  requireHttps(key);
}

if (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_URL
  && process.env.VITE_SUPABASE_URL !== process.env.SUPABASE_URL) {
  errors.push('VITE_SUPABASE_URL and SUPABASE_URL must identify the same project');
}

const origins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
if (origins.includes('*')) errors.push('ALLOWED_ORIGINS must not contain *');
for (const origin of origins) requireHttpsValue('ALLOWED_ORIGINS', origin);
if (process.env.PRODUCTION_WEB_URL && !origins.includes(process.env.PRODUCTION_WEB_URL)) {
  errors.push('ALLOWED_ORIGINS must contain PRODUCTION_WEB_URL exactly');
}
if (process.env.PUBLIC_APP_URL && process.env.PRODUCTION_WEB_URL
  && process.env.PUBLIC_APP_URL !== process.env.PRODUCTION_WEB_URL) {
  errors.push('PUBLIC_APP_URL must equal PRODUCTION_WEB_URL');
}

function requireHttpsValue(key, value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.origin !== value) errors.push(`${key} entries must be HTTPS origins without a path`);
  } catch {
    errors.push(`${key} contains an invalid origin`);
  }
}

if (process.env.LINE_LOGIN_ENABLED === 'true') {
  for (const key of ['LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET', 'LINE_LOGIN_CALLBACK_URL', 'LINE_SESSION_SECRET']) {
    if (!process.env[key]?.trim()) errors.push(`${key} is required when LINE_LOGIN_ENABLED=true`);
  }
  requireHttps('LINE_LOGIN_CALLBACK_URL');
}
if (process.env.NOTIFY_LINE_ENABLED === 'true' && !process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) {
  errors.push('LINE_CHANNEL_ACCESS_TOKEN is required when NOTIFY_LINE_ENABLED=true');
}

// CSP ของหน้าเว็บระบุ origin ของ API ไว้ตายตัวใน apps/web/public/_headers ถ้าย้าย PRODUCTION_API_URL
// ไปโดเมนอื่นแล้วลืมแก้ไฟล์นี้ เบราว์เซอร์จะบล็อกทุกคำขอ ทั้งที่ health check ฝั่ง Worker ยังเขียว
// และ smoke test ที่ยิงด้วย curl ก็ยังผ่าน — อาการจะโผล่กับผู้ใช้จริงเท่านั้น
const headersPath = resolve(process.env.WEB_HEADERS_FILE ?? 'apps/web/public/_headers');
let apiOrigin = '';
try {
  apiOrigin = new URL(process.env.PRODUCTION_API_URL ?? '').origin;
} catch {
  // URL ที่ขาดหรือผิดรูปถูกรายงานไปแล้วโดย requireHttps
}
if (apiOrigin) {
  try {
    const policy = (await readFile(headersPath, 'utf8')).match(/Content-Security-Policy:([^\n]*)/i)?.[1] ?? '';
    const connectSrc = policy
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => /^connect-src(\s|$)/i.test(directive));
    if (!connectSrc) {
      errors.push(`${headersPath} must declare a connect-src directive`);
    } else if (!connectSrc.split(/\s+/).slice(1).includes(apiOrigin)) {
      errors.push(`connect-src in ${headersPath} must list PRODUCTION_API_URL (${apiOrigin}) or the browser blocks every API call`);
    }
  } catch (error) {
    errors.push(`cannot read ${headersPath}: ${error instanceof Error ? error.message : error}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`Predeploy check failed: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Production configuration passed ${required.length} required checks; no secret values were printed.`);
}
