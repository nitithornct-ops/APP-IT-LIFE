import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * MFA is opt-in per account. Role assignment must not change the account's MFA state;
 * the explicit user-level switch is authoritative, and an enrolled factor only
 * determines whether the next step is a challenge or enrollment.
 */
export type MfaRequirementReason =
  | 'enrolled_factor'
  | 'user_enabled'
  | null;

export interface MfaPolicyDecision {
  required: boolean;
  reason: MfaRequirementReason;
}

export function evaluateMfaPolicy(
  _roleKeys: readonly string[],
  _permissionKeys: readonly string[],
  hasVerifiedFactor: boolean,
  mfaEnabled = false,
): MfaPolicyDecision {
  // The profile switch is the source of truth for the opt-in policy. A stale
  // factor must not silently turn MFA back on after an administrator disabled it.
  if (!mfaEnabled) return { required: false, reason: null };
  if (hasVerifiedFactor) return { required: true, reason: 'enrolled_factor' };
  return { required: true, reason: 'user_enabled' };
}

export async function loadMfaPolicy(
  supabase: SupabaseClient,
  hasVerifiedFactor: boolean,
  mfaEnabled?: boolean,
): Promise<MfaPolicyDecision> {
  let resolvedMfaEnabled = mfaEnabled;
  if (resolvedMfaEnabled === undefined) {
    const profileResult = await supabase.rpc('my_profile');
    if (profileResult.error) throw new Error('MFA_POLICY_LOOKUP_FAILED');
    const profile = Array.isArray(profileResult.data) ? profileResult.data[0] : profileResult.data;
    resolvedMfaEnabled = profile?.mfa_enabled === true;
  }

  return evaluateMfaPolicy([], [], hasVerifiedFactor, resolvedMfaEnabled);
}
