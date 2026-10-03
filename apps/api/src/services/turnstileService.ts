import type { Bindings } from '../types';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileVerifyResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
}

/** Verify a single-use token at the API trust boundary without logging it. */
export async function verifyTurnstile(
  env: Bindings,
  token: string,
  expectedAction: string,
  remoteIp?: string,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret || !token.trim()) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) return false;
    const result = await response.json() as TurnstileVerifyResponse;
    if (result.success !== true || result.action !== expectedAction) return false;
    const expectedHostname = env.TURNSTILE_EXPECTED_HOSTNAME?.trim();
    return !expectedHostname || result.hostname === expectedHostname;
  } catch {
    return false;
  }
}
