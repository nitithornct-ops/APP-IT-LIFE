import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from '../src/services/turnstileService';
import type { Bindings } from '../src/types';

const env: Bindings = {
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  ENVIRONMENT: 'test',
  TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
  TURNSTILE_EXPECTED_HOSTNAME: 'app.example.test',
};

afterEach(() => vi.restoreAllMocks());

describe('verifyTurnstile', () => {
  it('sends the token to Cloudflare and checks the action and hostname', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ success: true, action: 'login', hostname: 'app.example.test' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await expect(verifyTurnstile(env, 'widget-token', 'login', '192.0.2.10')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = new URLSearchParams(String((init as RequestInit).body));
    expect(body.get('secret')).toBe('test-turnstile-secret');
    expect(body.get('response')).toBe('widget-token');
    expect(body.get('remoteip')).toBe('192.0.2.10');
  });

  it('rejects an action or hostname mismatch without exposing provider details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ success: true, action: 'password_reset', hostname: 'other.example.test' }),
      { status: 200 },
    ));

    await expect(verifyTurnstile(env, 'widget-token', 'login', '192.0.2.10')).resolves.toBe(false);
  });

  it('fails closed when the secret is not configured or the provider errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider unavailable'));
    await expect(verifyTurnstile({ ...env, TURNSTILE_SECRET_KEY: undefined }, 'token', 'login', 'unknown'))
      .resolves.toBe(false);
    await expect(verifyTurnstile(env, 'token', 'login', 'unknown')).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
