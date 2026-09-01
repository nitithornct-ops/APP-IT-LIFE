import { type Page } from '@playwright/test';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPORARY_TOTP_NAME = 'Staging E2E temporary factor';
const temporaryTotpSecrets = new Map<string, string>();

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

function decodeBase32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of normalized) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('TOTP secret is not valid base32');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, offset = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const start = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[start] & 0x7f) << 24)
    | ((digest[start + 1] & 0xff) << 16)
    | ((digest[start + 2] & 0xff) << 8)
    | (digest[start + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function challengeTotp(client: SupabaseClient, factorId: string, secret: string): Promise<Session> {
  let lastError: unknown;
  for (const offset of [0, -1, 1]) {
    const { error } = await client.auth.mfa.challengeAndVerify({
      factorId,
      code: totpCode(secret, offset),
    });
    if (!error) {
      const { data: current, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (current.session) return current.session;
    }
    lastError = error;
  }
  throw lastError ?? new Error('Could not verify UAT TOTP factor');
}

async function verifyTotp(client: SupabaseClient, secret: string): Promise<Session> {
  const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
  if (factorsError) throw factorsError;
  const factor = factors.totp.find((candidate) => candidate.status === 'verified');
  if (!factor) throw new Error('UAT account has no verified TOTP factor');
  return challengeTotp(client, factor.id, secret);
}

function configuredTotpSecret(email: string, explicitSecret?: string): string | undefined {
  if (explicitSecret) return explicitSecret;
  const normalizedEmail = email.trim().toLowerCase();
  const temporarySecret = temporaryTotpSecrets.get(normalizedEmail);
  if (temporarySecret) return temporarySecret;
  for (const prefix of ['UAT_ADMIN', 'UAT_TECHNICIAN', 'UAT_APPROVER', 'UAT_MANAGER']) {
    if (process.env[`${prefix}_EMAIL`]?.trim().toLowerCase() === normalizedEmail) {
      return process.env[`${prefix}_TOTP_SECRET`]?.trim() || undefined;
    }
  }
  return undefined;
}

async function loadMfaPolicy(accessToken: string): Promise<{ required: boolean; enrolled: boolean; needsEnrollment: boolean }> {
  const response = await fetch('http://127.0.0.1:8787/api/v1/auth/mfa-policy', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json() as {
    success?: boolean;
    data?: { required: boolean; enrolled: boolean; needsEnrollment: boolean };
    error?: { message?: string };
  };
  if (!response.ok || !body.success || !body.data) {
    throw new Error(`Could not load live MFA policy (${response.status}): ${body.error?.message ?? 'unknown error'}`);
  }
  return body.data;
}

async function enrollTemporaryTotp(client: SupabaseClient, email: string): Promise<Session> {
  const { data: enrollment, error: enrollmentError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: TEMPORARY_TOTP_NAME,
  });
  if (enrollmentError || !enrollment) throw enrollmentError ?? new Error('Could not enroll temporary UAT TOTP factor');
  const session = await challengeTotp(client, enrollment.id, enrollment.totp.secret);
  temporaryTotpSecrets.set(email.trim().toLowerCase(), enrollment.totp.secret);
  return session;
}

export async function createLiveSession(email: string, totpSecret?: string, resetAttempted = false): Promise<Session> {
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
  const resolvedTotpSecret = configuredTotpSecret(email, totpSecret);
  if (resolvedTotpSecret) return verifyTotp(anon, resolvedTotpSecret);

  const policy = await loadMfaPolicy(data.session.access_token);
  if (policy.needsEnrollment) return enrollTemporaryTotp(anon, email);
  if (policy.required && policy.enrolled) {
    // A previous staging run can be interrupted after enrolling its disposable
    // factor. Remove only that named test factor; never touch a human MFA factor.
    if (!resetAttempted) {
      const userId = data.session.user.id;
      const { data: factorData, error: factorError } = await admin.auth.admin.mfa.listFactors({ userId });
      if (factorError) throw factorError;
      const disposableFactors = factorData.factors.filter((factor) => factor.friendly_name === TEMPORARY_TOTP_NAME);
      if (disposableFactors.length > 0) {
        for (const factor of disposableFactors) {
          const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
          if (deleteError) throw deleteError;
        }
        return createLiveSession(email, undefined, true);
      }
    }
    throw new Error(`A TOTP secret is required for the enrolled live UAT account ${email}`);
  }
  return data.session;
}

export async function createLiveAccessToken(email: string, totpSecret?: string): Promise<string> {
  return (await createLiveSession(email, totpSecret)).access_token;
}

export async function installLiveSession(page: Page, email: string, totpSecret?: string): Promise<Session> {
  const { supabaseUrl } = liveSupabaseConfig();
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const session = await createLiveSession(email, totpSecret);
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
  return session;
}
