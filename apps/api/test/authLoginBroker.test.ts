import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/types';

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  issueLoginChallenge: vi.fn(),
  consumeLoginChallenge: vi.fn(),
  verifyTurnstile: vi.fn(),
}));

vi.mock('../src/lib/supabase', () => ({
  createAdminClient: () => ({ rpc: (...args: unknown[]) => mocks.adminRpc(...args) }),
  createPublicAuthClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => mocks.signInWithPassword(...args),
      resetPasswordForEmail: (...args: unknown[]) => mocks.resetPasswordForEmail(...args),
    },
  }),
  createUserScopedClient: vi.fn(),
}));

vi.mock('../src/services/loginChallengeService', () => ({
  issueLoginChallenge: (...args: unknown[]) => mocks.issueLoginChallenge(...args),
  consumeLoginChallenge: (...args: unknown[]) => mocks.consumeLoginChallenge(...args),
}));

vi.mock('../src/services/turnstileService', () => ({
  verifyTurnstile: (...args: unknown[]) => mocks.verifyTurnstile(...args),
}));

import { authRoute } from '../src/routes/auth';

const env: Bindings = {
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  PUBLIC_APP_URL: 'https://app.example.test',
  ENVIRONMENT: 'test',
  TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
};

function post(path: string, body: Record<string, unknown>) {
  return authRoute.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.10', 'user-agent': 'test-agent' },
    body: JSON.stringify(body),
  }, env);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminRpc.mockResolvedValue({ data: 'user@example.test', error: null });
  mocks.issueLoginChallenge.mockResolvedValue('a'.repeat(64));
  mocks.consumeLoginChallenge.mockResolvedValue(true);
  mocks.verifyTurnstile.mockResolvedValue(true);
  mocks.signInWithPassword.mockResolvedValue({
    data: { session: { access_token: 'access-token', refresh_token: 'refresh-token' } },
    error: null,
  });
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

describe('authentication broker CAPTCHA handoff', () => {
  it('verifies Turnstile before issuing the opaque login challenge', async () => {
    const response = await post('/resolve-login', { identifier: 'somchai.j', turnstileToken: 'resolve-token' });

    expect(response.status).toBe(200);
    expect(mocks.issueLoginChallenge).toHaveBeenCalledOnce();
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(expect.anything(), 'resolve-token', 'login', '192.0.2.10');
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it('reports missing CAPTCHA configuration without blaming credentials', async () => {
    const response = await authRoute.request('/resolve-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.11' },
      body: JSON.stringify({ identifier: 'somchai.j', turnstileToken: 'token' }),
    }, { ...env, TURNSTILE_SECRET_KEY: undefined });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'LOGIN_UNAVAILABLE' } });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.issueLoginChallenge).not.toHaveBeenCalled();
  });

  it('reports a rejected challenge CAPTCHA separately from credentials', async () => {
    mocks.verifyTurnstile.mockResolvedValueOnce(false);
    const response = await post('/resolve-login', { identifier: 'somchai.j', turnstileToken: 'expired-token' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'LOGIN_CAPTCHA_FAILED' } });
    expect(mocks.issueLoginChallenge).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'captcha_failed', status: 400 }, 400, 'LOGIN_CAPTCHA_FAILED'],
    [{ code: 'over_request_rate_limit', status: 429 }, 429, 'LOGIN_RATE_LIMITED'],
    [{ code: 'unexpected_failure', status: 500 }, 503, 'LOGIN_UNAVAILABLE'],
    [{ status: 0 }, 503, 'LOGIN_UNAVAILABLE'],
    [{ code: 'invalid_credentials', status: 400 }, 401, 'LOGIN_FAILED'],
  ])('maps provider error %j to %s %s', async (error, status, code) => {
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error });
    const response = await post('/login', {
      identifier: 'somchai.j', password: 'password', challenge: 'a'.repeat(64), turnstileToken: 'token',
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it('reports a database lookup failure as service unavailable', async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
    const response = await post('/login', {
      identifier: 'somchai.j', password: 'password', challenge: 'a'.repeat(64), turnstileToken: 'token',
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'LOGIN_UNAVAILABLE' } });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it('passes the one-time Turnstile token to Supabase with the password', async () => {
    const response = await post('/login', {
      identifier: 'somchai.j',
      password: 'correct-password',
      challenge: 'a'.repeat(64),
      turnstileToken: 'turnstile-token',
    });

    expect(response.status).toBe(200);
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.test',
      password: 'correct-password',
      options: { captchaToken: 'turnstile-token' },
    });
  });

  it('passes Turnstile to the Supabase password-reset endpoint', async () => {
    const response = await post('/password-reset-request', {
      email: 'user@example.test',
      turnstileToken: 'turnstile-token',
    });

    expect(response.status).toBe(200);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('user@example.test', {
      redirectTo: 'https://app.example.test/reset-password',
      captchaToken: 'turnstile-token',
    });
  });

  it('does not report password reset success when Supabase rejects CAPTCHA', async () => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { code: 'captcha_failed' } });

    const response = await post('/password-reset-request', {
      email: 'user@example.test',
      turnstileToken: 'turnstile-token',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'PASSWORD_RESET_FAILED' } });
  });
});
