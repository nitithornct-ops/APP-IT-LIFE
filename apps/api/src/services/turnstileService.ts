import type { Bindings } from '../types';

export const PUBLIC_TICKET_TURNSTILE_ACTION = 'public_ticket';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;

type TurnstileFailureReason =
  | 'configuration'
  | 'token'
  | 'network'
  | 'response'
  | 'rejected';

export type TurnstileVerification =
  | { ok: true; hostname: string }
  | { ok: false; reason: TurnstileFailureReason };

interface SiteverifyResult {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
}

function expectedHostnames(env: Bindings): Set<string> | null {
  const hostnames = new Set(
    (env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );
  if (hostnames.size === 0) return null;
  if ([...hostnames].some((hostname) => !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|localhost)$/.test(hostname))) return null;
  if (env.ENVIRONMENT === 'production' && (hostnames.has('localhost') || hostnames.has('127.0.0.1'))) return null;
  return hostnames;
}

/** Canonical server-side Turnstile validation. Every error path deliberately fails closed. */
export async function verifyPublicTicketTurnstile(
  env: Bindings,
  token: string,
  remoteIp: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileVerification> {
  const secret = env.TURNSTILE_SECRET?.trim();
  const hostnames = expectedHostnames(env);
  if (!secret || !hostnames) return { ok: false, reason: 'configuration' };
  if (!token || token.length > MAX_TOKEN_LENGTH || token.trim() !== token) return { ok: false, reason: 'token' };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp.split(',')[0]!.trim());

  let response: Response;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!response.ok) return { ok: false, reason: 'response' };

  let result: SiteverifyResult;
  try {
    result = await response.json() as SiteverifyResult;
  } catch {
    return { ok: false, reason: 'response' };
  }
  const hostname = typeof result.hostname === 'string' ? result.hostname.toLowerCase() : '';
  if (
    result.success !== true
    || result.action !== PUBLIC_TICKET_TURNSTILE_ACTION
    || !hostnames.has(hostname)
  ) {
    return { ok: false, reason: 'rejected' };
  }
  return { ok: true, hostname };
}
