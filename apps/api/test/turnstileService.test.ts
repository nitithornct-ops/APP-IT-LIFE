import { describe, expect, it, vi } from 'vitest';
import { verifyPublicTicketTurnstile } from '../src/services/turnstileService';
import type { Bindings } from '../src/types';

const env: Bindings = {
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGINS: 'https://support.example.com',
  ENVIRONMENT: 'test',
  TURNSTILE_SECRET: 'test-secret',
  TURNSTILE_HOSTNAMES: 'support.example.com,localhost',
};

describe('verifyPublicTicketTurnstile', () => {
  it('accepts only success with the exact action and an allowlisted hostname', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: 'public_ticket',
      hostname: 'support.example.com',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(verifyPublicTicketTurnstile(env, 'valid-token', '203.0.113.10', fetchMock)).resolves.toEqual({
      ok: true,
      hostname: 'support.example.com',
    });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = init?.body as URLSearchParams;
    expect(body.get('secret')).toBe('test-secret');
    expect(body.get('response')).toBe('valid-token');
    expect(body.get('remoteip')).toBe('203.0.113.10');
  });

  it.each([
    { success: false, action: 'public_ticket', hostname: 'support.example.com' },
    { success: true, action: 'login', hostname: 'support.example.com' },
    { success: true, action: 'public_ticket', hostname: 'evil.example.com' },
  ])('rejects an invalid siteverify result %#', async (result) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    await expect(verifyPublicTicketTurnstile(env, 'valid-token', 'unknown', fetchMock)).resolves.toEqual({ ok: false, reason: 'rejected' });
  });

  it('fails closed without a secret or hostname allowlist', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(verifyPublicTicketTurnstile({ ...env, TURNSTILE_SECRET: undefined }, 'token', 'unknown', fetchMock))
      .resolves.toEqual({ ok: false, reason: 'configuration' });
    await expect(verifyPublicTicketTurnstile({ ...env, TURNSTILE_HOSTNAMES: '' }, 'token', 'unknown', fetchMock))
      .resolves.toEqual({ ok: false, reason: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects local hostnames in the production backend allowlist', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(verifyPublicTicketTurnstile({ ...env, ENVIRONMENT: 'production' }, 'token', 'unknown', fetchMock))
      .resolves.toEqual({ ok: false, reason: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on network, non-2xx and malformed JSON responses', async () => {
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json', { status: 200 }));
    await expect(verifyPublicTicketTurnstile(env, 'token', 'unknown', network)).resolves.toEqual({ ok: false, reason: 'network' });
    await expect(verifyPublicTicketTurnstile(env, 'token', 'unknown', upstream)).resolves.toEqual({ ok: false, reason: 'response' });
    await expect(verifyPublicTicketTurnstile(env, 'token', 'unknown', malformed)).resolves.toEqual({ ok: false, reason: 'response' });
  });
});
