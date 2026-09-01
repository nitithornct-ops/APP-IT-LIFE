import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeLineLoginCallback, createLineLoginUrl, getLineLoginConfigStatus, hashSessionToken,
  normalizeReturnMode, randomToken, sessionHours,
} from '../src/lib/lineAuth';
import { lineAdminUpdateLinkSchema, lineProfileSchema, lineSubmitTicketSchema, lineTicketMessageSchema } from '../src/validators/line';
import type { Bindings } from '../src/types';

const configuredEnv: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  ENVIRONMENT: 'test',
  LINE_LOGIN_ENABLED: 'true',
  LINE_LOGIN_CHANNEL_ID: '1234567890',
  LINE_LOGIN_CHANNEL_SECRET: 'a-secret-at-least-twenty-chars',
  LINE_LOGIN_CALLBACK_URL: 'https://api.example.com/api/v1/line/callback',
  LINE_SESSION_SECRET: 'session-secret',
};

describe('getLineLoginConfigStatus', () => {
  it('reports disabled when LINE_LOGIN_ENABLED is unset', () => {
    const status = getLineLoginConfigStatus({ ...configuredEnv, LINE_LOGIN_ENABLED: undefined });
    expect(status).toEqual({ enabled: false, configured: false, message: 'LINE Login ยังไม่เปิดใช้งาน' });
  });

  it('reports which fields are missing when enabled but incomplete', () => {
    const status = getLineLoginConfigStatus({ ...configuredEnv, LINE_LOGIN_CHANNEL_SECRET: undefined });
    expect(status.enabled).toBe(true);
    expect(status.configured).toBe(false);
    expect(status.message).toContain('LINE_LOGIN_CHANNEL_SECRET');
  });

  it('reports configured when every required field is present', () => {
    expect(getLineLoginConfigStatus(configuredEnv)).toEqual({ enabled: true, configured: true, message: '' });
  });
});

describe('randomToken', () => {
  it('produces a 64-char lowercase hex token, different every call', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('hashSessionToken', () => {
  it('is deterministic for the same secret and token', async () => {
    const first = await hashSessionToken('secret', 'token-value');
    const second = await hashSessionToken('secret', 'token-value');
    expect(first).toBe(second);
  });

  it('differs when the secret differs (so a leaked hash cannot be replayed against another deployment)', async () => {
    const a = await hashSessionToken('secret-a', 'token-value');
    const b = await hashSessionToken('secret-b', 'token-value');
    expect(a).not.toBe(b);
  });
});

describe('normalizeReturnMode / sessionHours', () => {
  it('falls back to "report" for anything not in the allowed set', () => {
    expect(normalizeReturnMode('status')).toBe('status');
    expect(normalizeReturnMode('kb')).toBe('kb');
    expect(normalizeReturnMode('bogus')).toBe('report');
    expect(normalizeReturnMode(undefined)).toBe('report');
  });

  it('clamps LINE_SESSION_HOURS into [1, 720] and defaults to 24', () => {
    expect(sessionHours({ ...configuredEnv, LINE_SESSION_HOURS: undefined })).toBe(24);
    expect(sessionHours({ ...configuredEnv, LINE_SESSION_HOURS: '0' })).toBe(1);
    expect(sessionHours({ ...configuredEnv, LINE_SESSION_HOURS: '10000' })).toBe(720);
    expect(sessionHours({ ...configuredEnv, LINE_SESSION_HOURS: '48' })).toBe(48);
  });
});

describe('createLineLoginUrl', () => {
  it('throws with the config-status message when LINE Login is not configured', async () => {
    await expect(createLineLoginUrl({ ...configuredEnv, LINE_LOGIN_ENABLED: undefined }, 'report'))
      .rejects.toThrow('LINE Login ยังไม่เปิดใช้งาน');
  });

  it('builds an authorize URL with PKCE S256, the configured client_id, and openid+profile scope', async () => {
    const url = new URL(await createLineLoginUrl(configuredEnv, 'status'));
    expect(url.origin + url.pathname).toBe('https://access.line.me/oauth2/v2.1/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(configuredEnv.LINE_LOGIN_CHANNEL_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(configuredEnv.LINE_LOGIN_CALLBACK_URL);
    expect(url.searchParams.get('scope')).toBe('openid profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('nonce')).not.toBe(url.searchParams.get('state'));
    expect(url.searchParams.get('state')).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe('LINE ticket submit validator', () => {
  const validPayload = {
    categoryId: '11111111-1111-4111-8111-111111111111',
    requesterPhone: '0812345678',
    title: 'เปิดเครื่องไม่ติด',
    description: 'กดปุ่มแล้วเครื่องไม่มีไฟ',
    privacyConsent: true,
  };

  it('accepts contact and asset fields from the shared report form', () => {
    expect(lineSubmitTicketSchema.safeParse({
      ...validPayload,
      requesterPhone: '0812345678',
      requesterPosition: 'นักบัญชี',
      department: 'บัญชี',
      incidentAt: '2026-08-26T02:30:00.000Z',
      erpModule: 'Finance',
      location: 'อาคาร A ชั้น 3',
      assetCode: 'NB-0231',
    }).success).toBe(true);
  });

  it('requires the privacy consent used by the shared report form', () => {
    expect(lineSubmitTicketSchema.safeParse({ ...validPayload, privacyConsent: false }).success).toBe(false);
    expect(lineSubmitTicketSchema.safeParse({ ...validPayload, privacyConsent: undefined }).success).toBe(false);
  });

  it('allows an omitted or short requester phone', () => {
    expect(lineSubmitTicketSchema.safeParse({ ...validPayload, requesterPhone: undefined }).success).toBe(true);
    expect(lineSubmitTicketSchema.safeParse({ ...validPayload, requesterPhone: '   ' }).success).toBe(true);
    expect(lineSubmitTicketSchema.safeParse({ ...validPayload, requesterPhone: '1234567' }).success).toBe(true);
  });
});

describe('LINE profile validator', () => {
  it('accepts a manually entered requester name and trims it', () => {
    expect(lineProfileSchema.parse({ fullName: '  สมชาย ใจดี  ' })).toEqual({ fullName: 'สมชาย ใจดี' });
  });

  it('rejects an empty requester name', () => {
    expect(lineProfileSchema.safeParse({ fullName: ' ' }).success).toBe(false);
  });

  it('requires both a first name and a last name', () => {
    expect(lineProfileSchema.safeParse({ fullName: 'สมชาย' }).success).toBe(false);
  });
});

describe('LINE admin link validator', () => {
  it('accepts a profile UUID or null for unlinking', () => {
    expect(lineAdminUpdateLinkSchema.safeParse({ userId: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
    expect(lineAdminUpdateLinkSchema.safeParse({ userId: null }).success).toBe(true);
  });

  it('rejects an invalid profile id', () => {
    expect(lineAdminUpdateLinkSchema.safeParse({ userId: 'not-a-user-id' }).success).toBe(false);
  });
});

describe('completeLineLoginCallback', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  function mockLineApis(nonce: string, overrides: { sub?: string; aud?: string; friendFlag?: boolean } = {}) {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth2/v2.1/token')) {
        return new Response(JSON.stringify({ id_token: 'fake-id-token', access_token: 'fake-access-token' }), { status: 200 });
      }
      if (url.includes('/oauth2/v2.1/verify')) {
        return new Response(JSON.stringify({
          sub: overrides.sub ?? `U${'a'.repeat(32)}`,
          aud: overrides.aud ?? configuredEnv.LINE_LOGIN_CHANNEL_ID,
          nonce, name: 'ทดสอบ ผู้ใช้', picture: 'https://example.com/pic.jpg',
        }), { status: 200 });
      }
      if (url.includes('/friendship/v1/status')) {
        return new Response(JSON.stringify({ friendFlag: overrides.friendFlag ?? true }), { status: 200 });
      }
      if (url.includes('/oauth2/v2.1/revoke')) {
        return new Response('', { status: 200 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
  }

  it('rejects when LINE redirects back with an error param', async () => {
    await expect(completeLineLoginCallback(configuredEnv, { error: 'access_denied', error_description: 'user cancelled' }))
      .rejects.toThrow('LINE ปฏิเสธการเข้าสู่ระบบ');
  });

  it('rejects a forged/expired state (fails signature verification)', async () => {
    await expect(completeLineLoginCallback(configuredEnv, { code: 'abc', state: 'not-a-real-signed-state' }))
      .rejects.toThrow('คำขอ LINE Login หมดอายุหรือไม่ถูกต้อง');
  });

  it('completes the flow end to end: builds a login URL, then resolves the callback with matching nonce', async () => {
    const url = new URL(await createLineLoginUrl(configuredEnv, 'kb'));
    const state = url.searchParams.get('state')!;
    mockLineApis(url.searchParams.get('nonce')!, { sub: `U${'b'.repeat(32)}` });

    const result = await completeLineLoginCallback(configuredEnv, { code: 'auth-code', state });
    expect(result.lineUserId).toBe(`U${'b'.repeat(32)}`);
    expect(result.displayName).toBe('ทดสอบ ผู้ใช้');
    expect(result.friendStatus).toBe('Friend');
    expect(result.returnMode).toBe('kb');
    // the access token must be revoked, not persisted anywhere
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(([req]) => String(req).includes('/oauth2/v2.1/revoke'))).toBe(true);
  });

  it('rejects when the verified ID token aud does not match the configured channel (token issued for a different channel)', async () => {
    const url = new URL(await createLineLoginUrl(configuredEnv, 'report'));
    const state = url.searchParams.get('state')!;
    mockLineApis(url.searchParams.get('nonce')!, { aud: '999999999' });
    await expect(completeLineLoginCallback(configuredEnv, { code: 'auth-code', state })).rejects.toThrow('ไม่ได้ออกให้ Channel นี้');
  });
});

describe('lineTicketMessageSchema', () => {
  it('ตัดช่องว่างหัวท้ายและรับข้อความปกติ', () => {
    expect(lineTicketMessageSchema.parse({ message: '  รับทราบครับ  ' })).toEqual({ message: 'รับทราบครับ' });
  });

  it('ปฏิเสธข้อความว่างและข้อความที่ยาวเกินขีดจำกัด', () => {
    expect(lineTicketMessageSchema.safeParse({ message: '   ' }).success).toBe(false);
    expect(lineTicketMessageSchema.safeParse({ message: 'ก'.repeat(1001) }).success).toBe(false);
    expect(lineTicketMessageSchema.safeParse({ message: 'ก'.repeat(1000) }).success).toBe(true);
  });
});
