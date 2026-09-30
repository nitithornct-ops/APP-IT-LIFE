import type { SupabaseClient } from '@supabase/supabase-js';
import { randomToken } from '../lib/lineAuth';
import { sha256Hex } from './auditService';

export const LOGIN_CHALLENGE_TTL_MS = 5 * 60_000;

export type LoginChallengeFlow = 'internal' | 'vendor';

function normalizedIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

async function fingerprint(value: string): Promise<string> {
  return sha256Hex(value);
}

export async function issueLoginChallenge(
  admin: SupabaseClient,
  options: {
    flow: LoginChallengeFlow;
    identifier: string;
    ip: string;
    userAgent: string;
  },
): Promise<string> {
  const token = randomToken();
  const identifierKey = `${options.flow}\u0000${normalizedIdentifier(options.identifier)}`;
  const contextKey = `${options.flow}\u0000${options.ip}\u0000${options.userAgent.slice(0, 500)}`;
  const [challengeHash, identifierHash, contextHash] = await Promise.all([
    fingerprint(token),
    fingerprint(identifierKey),
    fingerprint(contextKey),
  ]);
  const expiresAt = new Date(Date.now() + LOGIN_CHALLENGE_TTL_MS).toISOString();

  const { error } = await admin.from('login_challenges').insert({
    challenge_hash: challengeHash,
    flow: options.flow,
    identifier_hash: identifierHash,
    context_hash: contextHash,
    expires_at: expiresAt,
  });
  if (error) throw error;

  // Expired rows are security metadata, not user data. Prune a bounded batch
  // opportunistically so a public endpoint cannot grow this table forever.
  try {
    await admin.rpc('purge_expired_login_challenges', { max_rows_input: 100 });
  } catch {
    // Pruning is best effort; it must never turn a valid challenge into a 5xx.
  }
  return token;
}

export async function consumeLoginChallenge(
  admin: SupabaseClient,
  options: {
    token: string;
    flow: LoginChallengeFlow;
    identifier: string;
    ip: string;
    userAgent: string;
  },
): Promise<boolean> {
  const identifierKey = `${options.flow}\u0000${normalizedIdentifier(options.identifier)}`;
  const contextKey = `${options.flow}\u0000${options.ip}\u0000${options.userAgent.slice(0, 500)}`;
  const [challengeHash, identifierHash, contextHash] = await Promise.all([
    fingerprint(options.token),
    fingerprint(identifierKey),
    fingerprint(contextKey),
  ]);
  const { data, error } = await admin
    .from('login_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('challenge_hash', challengeHash)
    .eq('flow', options.flow)
    .eq('identifier_hash', identifierHash)
    .eq('context_hash', contextHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();

  return !error && Boolean(data);
}
