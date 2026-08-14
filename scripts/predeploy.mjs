const required = [
  'PRODUCTION_DEPLOY_CONFIRM',
  'PRODUCTION_WEB_URL',
  'PRODUCTION_API_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
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
  'STAGING_E2E_APPROVAL_REF',
];

const errors = [];
for (const key of required) {
  if (!process.env[key]?.trim()) errors.push(`${key} is required`);
}

if (process.env.PRODUCTION_DEPLOY_CONFIRM !== 'DEPLOY') errors.push('PRODUCTION_DEPLOY_CONFIRM must equal DEPLOY');

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

if (errors.length) {
  for (const error of errors) console.error(`Predeploy check failed: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Production configuration passed ${required.length} required checks; no secret values were printed.`);
}
