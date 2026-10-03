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
  it('does not consume Turnstile while issuing the opaque login challenge', async () => {
    const response = await post('/resolve-login', { identifier: 'somchai.j', turnstileToken: 'resolve-token' });

    expect(response.status).toBe(200);
    expect(mocks.issueLoginChallenge).toHaveBeenCalledOnce();
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(expect.anything(), 'resolve-token', 'login', '192.0.2.10');
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
});
