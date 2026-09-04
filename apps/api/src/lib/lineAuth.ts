import type { Bindings } from '../types';

/**
 * LINE Login (OAuth 2.0 / OIDC + PKCE) for the public ticket portal — port of legacy-gas/LineAuth.gs.
 * Workers has no CacheService equivalent, so OAuth `state` is self-contained instead of
 * server-stored. The state is AES-GCM encrypted with a key derived from LINE_SESSION_SECRET,
 * keeping the PKCE verifier confidential while also providing integrity and expiry checks.
 */

const AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const REVOKE_URL = 'https://api.line.me/oauth2/v2.1/revoke';
const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const FRIENDSHIP_STATUS_URL = 'https://api.line.me/friendship/v1/status';
const STATE_TTL_SEC = 1800;

export type LineReturnMode = 'report' | 'status' | 'kb';

export function normalizeReturnMode(mode: string | undefined | null): LineReturnMode {
  return mode === 'status' || mode === 'kb' ? mode : 'report';
}

interface StatePayload {
  nonce: string;
  verifier: string;
  browserBindingHash: string;
  redirectUri: string;
  returnMode: LineReturnMode;
  createdAt: number;
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toBase64Url(signature);
}

async function hmacVerify(secret: string, message: string, encodedSignature: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(encodedSignature),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

export async function hashSessionToken(secret: string, token: string): Promise<string> {
  return hmacSign(secret, token);
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
}

async function createPkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(await sha256(verifier));
}

async function stateEncryptionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', await sha256(secret), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptState(payload: StatePayload, secret: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await stateEncryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

function isValidStatePayload(value: unknown): value is StatePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<StatePayload>;
  const age = Date.now() - Number(payload.createdAt);
  return /^[0-9a-f]{64}$/.test(payload.nonce ?? '')
    && /^[0-9a-f]{64}$/.test(payload.verifier ?? '')
    && /^[A-Za-z0-9_-]{43}$/.test(payload.browserBindingHash ?? '')
    && typeof payload.redirectUri === 'string'
    && payload.redirectUri.length <= 1000
    && ['report', 'status', 'kb'].includes(payload.returnMode ?? '')
    && Number.isFinite(payload.createdAt)
    && age >= -60_000
    && age <= STATE_TTL_SEC * 1000;
}

async function verifyState(state: string, secret: string): Promise<StatePayload | null> {
  if (state.length > 4096) return null;
  const [version, encodedIv, encodedCiphertext, extra] = state.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext || extra) return null;
  try {
    const iv = fromBase64Url(encodedIv);
    if (iv.byteLength !== 12) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      await stateEncryptionKey(secret),
      fromBase64Url(encodedCiphertext),
    );
    const payload: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    return isValidStatePayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export interface LineLoginConfigStatus {
  enabled: boolean;
  configured: boolean;
  message: string;
}

export function getLineLoginConfigStatus(env: Bindings): LineLoginConfigStatus {
  const enabled = env.LINE_LOGIN_ENABLED === 'true';
  if (!enabled) return { enabled: false, configured: false, message: 'LINE Login ยังไม่เปิดใช้งาน' };
  const missing = ['LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET', 'LINE_LOGIN_CALLBACK_URL', 'LINE_SESSION_SECRET']
    .filter((key) => !env[key as keyof Bindings]);
  if (missing.length > 0) return { enabled: true, configured: false, message: `ยังตั้งค่า LINE Login ไม่ครบ: ${missing.join(', ')}` };
  return { enabled: true, configured: true, message: '' };
}

type ConfiguredBindings = Bindings & Required<Pick<Bindings, 'LINE_LOGIN_CHANNEL_ID' | 'LINE_LOGIN_CHANNEL_SECRET' | 'LINE_LOGIN_CALLBACK_URL' | 'LINE_SESSION_SECRET'>>;

/** Throws with the same message getLineLoginConfigStatus would report; narrows the four LINE_LOGIN_* fields to `string` for the rest of the caller's scope. */
function requireLineConfig(env: Bindings): asserts env is ConfiguredBindings {
  const status = getLineLoginConfigStatus(env);
  if (!status.configured) throw new Error(status.message);
}

export async function createLineLoginUrl(env: Bindings, returnMode: string | undefined, browserBinding: string): Promise<string> {
  requireLineConfig(env);
  if (!/^[0-9a-f]{64}$/.test(browserBinding)) throw new Error('LINE Login browser binding ไม่ถูกต้อง');

  const verifier = randomToken();
  const nonce = randomToken();
  const state = await encryptState({
    nonce,
    verifier,
    browserBindingHash: await hmacSign(env.LINE_SESSION_SECRET, `line-oauth-browser:${browserBinding}`),
    redirectUri: env.LINE_LOGIN_CALLBACK_URL,
    returnMode: normalizeReturnMode(returnMode),
    createdAt: Date.now(),
  }, env.LINE_SESSION_SECRET);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINE_LOGIN_CHANNEL_ID,
    redirect_uri: env.LINE_LOGIN_CALLBACK_URL,
    state,
    scope: 'openid profile',
    nonce,
    code_challenge: await createPkceChallenge(verifier),
    code_challenge_method: 'S256',
    bot_prompt: 'normal',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface LineTokenResponse {
  id_token: string;
  access_token: string;
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function exchangeAuthorizationCode(env: ConfiguredBindings, code: string, redirectUri: string, verifier: string): Promise<LineTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.LINE_LOGIN_CHANNEL_ID,
      client_secret: env.LINE_LOGIN_CHANNEL_SECRET,
      code_verifier: verifier,
    }),
  });
  const body = await safeJson(response);
  if (!response.ok || !body.id_token || !body.access_token) {
    throw new Error(`แลก LINE authorization code ไม่สำเร็จ (HTTP ${response.status}): ${String(body.error_description ?? body.error ?? 'Unknown error')}`);
  }
  return body as unknown as LineTokenResponse;
}

export interface LineIdTokenClaims {
  sub: string;
  name?: string;
  picture?: string;
}

async function verifyIdToken(env: ConfiguredBindings, idToken: string, expectedNonce: string): Promise<LineIdTokenClaims> {
  const response = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: env.LINE_LOGIN_CHANNEL_ID, nonce: expectedNonce }),
  });
  const body = await safeJson(response);
  if (!response.ok || !body.sub) {
    throw new Error(`ตรวจ LINE ID token ไม่สำเร็จ (HTTP ${response.status}): ${String(body.error_description ?? body.error ?? 'Unknown error')}`);
  }
  if (String(body.aud ?? '') !== env.LINE_LOGIN_CHANNEL_ID) throw new Error('LINE ID token ไม่ได้ออกให้ Channel นี้');
  if (String(body.nonce ?? '') !== expectedNonce) throw new Error('LINE Login nonce ไม่ตรงกัน กรุณาเริ่ม Login ใหม่');
  if (body.exp && Number(body.exp) * 1000 <= Date.now()) throw new Error('LINE ID token หมดอายุแล้ว');
  const sub = String(body.sub);
  if (!/^U[0-9a-f]{32}$/i.test(sub)) throw new Error('LINE ไม่ได้ส่ง userId ที่ถูกต้องกลับมา');
  return { sub, name: typeof body.name === 'string' ? body.name : undefined, picture: typeof body.picture === 'string' ? body.picture : undefined };
}

async function getFriendshipStatus(accessToken: string): Promise<boolean | null> {
  try {
    const response = await fetch(FRIENDSHIP_STATUS_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return null;
    const body = (await response.json()) as { friendFlag?: boolean };
    return body.friendFlag === true;
  } catch {
    return null;
  }
}

/** Never persist the LINE access/refresh token — revoke it right after reading profile/friendship; the app's own session replaces it. */
async function revokeAccessToken(env: ConfiguredBindings, accessToken: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken, client_id: env.LINE_LOGIN_CHANNEL_ID, client_secret: env.LINE_LOGIN_CHANNEL_SECRET }),
    });
  } catch {
    /* best-effort cleanup only */
  }
}

export interface CompletedLineLogin {
  lineUserId: string;
  displayName: string;
  pictureUrl: string | null;
  friendStatus: 'Friend' | 'NotFriend' | 'Unknown';
  returnMode: LineReturnMode;
}

/** Callback entrypoint: verifies `code`/`state`, exchanges the code, verifies the ID token, and revokes the LINE token. */
export async function completeLineLoginCallback(
  env: Bindings, params: { code?: string; state?: string; error?: string; error_description?: string },
  browserBinding: string | undefined,
): Promise<CompletedLineLogin> {
  requireLineConfig(env);
  if (params.error) throw new Error(`LINE ปฏิเสธการเข้าสู่ระบบ: ${params.error_description ?? params.error}`);
  if (!params.code || !params.state) throw new Error('LINE callback ไม่มี authorization code หรือ state');

  const pending = await verifyState(params.state, env.LINE_SESSION_SECRET);
  if (!pending) throw new Error('คำขอ LINE Login หมดอายุหรือไม่ถูกต้อง กรุณาเริ่ม Login ใหม่');
  if (!browserBinding || !/^[0-9a-f]{64}$/.test(browserBinding)
    || !await hmacVerify(env.LINE_SESSION_SECRET, `line-oauth-browser:${browserBinding}`, pending.browserBindingHash)) {
    throw new Error('คำขอ LINE Login ไม่ได้เริ่มจาก browser นี้ กรุณาเริ่ม Login ใหม่');
  }
  if (pending.redirectUri !== env.LINE_LOGIN_CALLBACK_URL) throw new Error('LINE Login callback URL ไม่ถูกต้อง กรุณาเริ่ม Login ใหม่');

  const tokenData = await exchangeAuthorizationCode(env, params.code, pending.redirectUri, pending.verifier);
  const claims = await verifyIdToken(env, tokenData.id_token, pending.nonce);
  const friendFlag = await getFriendshipStatus(tokenData.access_token);
  await revokeAccessToken(env, tokenData.access_token);

  return {
    lineUserId: claims.sub,
    displayName: claims.name?.slice(0, 160) || 'LINE User',
    pictureUrl: claims.picture?.slice(0, 1000) ?? null,
    friendStatus: friendFlag === true ? 'Friend' : friendFlag === false ? 'NotFriend' : 'Unknown',
    returnMode: pending.returnMode,
  };
}

export function sessionHours(env: Bindings): number {
  const hours = Number(env.LINE_SESSION_HOURS ?? '24');
  return Number.isFinite(hours) ? Math.min(Math.max(hours, 1), 720) : 24;
}
