import { type Page } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function liveSupabaseConfig() {
  const path = resolve(process.cwd(), '../api/.dev.vars');
  const vars = Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
  const supabaseUrl = vars.SUPABASE_URL;
  const anonKey = vars.SUPABASE_ANON_KEY;
  const serviceRoleKey = vars.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Live Supabase configuration is incomplete');
  return { supabaseUrl, anonKey, serviceRoleKey };
}

export async function createLiveSession(email: string): Promise<Session> {
  const { supabaseUrl, anonKey, serviceRoleKey } = liveSupabaseConfig();
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError || !link.properties.hashed_token) throw linkError ?? new Error('Could not generate a live test link');

  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  if (error || !data.session) throw error ?? new Error('Could not create a live test session');
  return data.session;
}

export async function createLiveAccessToken(email: string): Promise<string> {
  return (await createLiveSession(email)).access_token;
}

export async function installLiveSession(page: Page, email: string): Promise<void> {
  const { supabaseUrl } = liveSupabaseConfig();
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const session = await createLiveSession(email);
  const loginLog = await fetch('http://127.0.0.1:8787/api/v1/auth/login-log', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, success: true }),
  });
  if (!loginLog.ok) throw new Error(`Could not record live test login (${loginLog.status})`);
  await page.addInitScript(
    ({ storageKey, serializedSession }) => localStorage.setItem(storageKey, serializedSession),
    { storageKey: `sb-${projectRef}-auth-token`, serializedSession: JSON.stringify(session) },
  );
  await page.goto('/');
}
