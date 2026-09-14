import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase';
import { permissionRecipientIds } from './permissionRecipientService';
import type { Bindings } from '../types';

/**
 * MFA is mandatory for privileged identities, even when the account has not enrolled a
 * factor yet. These keys come from the configurable RBAC catalog; the checks use the
 * caller's resolved roles/permissions, not claims supplied by the browser.
 */
export const MFA_ADMIN_ROLE_KEYS = new Set(['super_admin', 'it_admin']);
export const MFA_APPROVER_ROLE_KEYS = new Set(['approver']);
export const MFA_APPROVAL_PERMISSION_KEYS = new Set([
  'access_request.approve',
  'change.approve',
  'data_class.approve',
  'service_request.approve',
  'workflow.approve',
]);
export const MFA_EXPORT_PERMISSION_KEYS = new Set(['report.export', 'evidence.export']);

export type MfaRequirementReason =
  | 'enrolled_factor'
  | 'user_enabled'
  | 'admin_role'
  | 'approver_role'
  | 'approval_permission'
  | 'export_permission'
  | null;

export interface MfaPolicyDecision {
  required: boolean;
  reason: MfaRequirementReason;
}

export function evaluateMfaPolicy(
  roleKeys: readonly string[],
  permissionKeys: readonly string[],
  hasVerifiedFactor: boolean,
  mfaEnabled = false,
): MfaPolicyDecision {
  if (hasVerifiedFactor) return { required: true, reason: 'enrolled_factor' };
  if (mfaEnabled) return { required: true, reason: 'user_enabled' };
  if (roleKeys.some((key) => MFA_ADMIN_ROLE_KEYS.has(key))) return { required: true, reason: 'admin_role' };
  if (roleKeys.some((key) => MFA_APPROVER_ROLE_KEYS.has(key))) return { required: true, reason: 'approver_role' };
  if (permissionKeys.some((key) => MFA_APPROVAL_PERMISSION_KEYS.has(key))) return { required: true, reason: 'approval_permission' };
  if (permissionKeys.some((key) => MFA_EXPORT_PERMISSION_KEYS.has(key))) return { required: true, reason: 'export_permission' };
  return { required: false, reason: null };
}

export async function loadMfaPolicy(
  supabase: SupabaseClient,
  hasVerifiedFactor: boolean,
  mfaEnabled?: boolean,
): Promise<MfaPolicyDecision> {
  const [rolesResult, permissionsResult] = await Promise.all([
    supabase.rpc('my_roles'),
    supabase.rpc('my_permissions'),
  ]);
  if (rolesResult.error || permissionsResult.error) {
    throw new Error('MFA_POLICY_LOOKUP_FAILED');
  }

  let resolvedMfaEnabled = mfaEnabled;
  if (resolvedMfaEnabled === undefined) {
    const profileResult = await supabase.rpc('my_profile');
    if (profileResult.error) throw new Error('MFA_POLICY_LOOKUP_FAILED');
    const profile = Array.isArray(profileResult.data) ? profileResult.data[0] : profileResult.data;
    resolvedMfaEnabled = profile?.mfa_enabled === true;
  }

  const roleKeys = (rolesResult.data ?? []).map((row: { role_key: string }) => row.role_key);
  const permissionKeys = (permissionsResult.data ?? []).map((row: { permission_key: string }) => row.permission_key);
  return evaluateMfaPolicy(roleKeys, permissionKeys, hasVerifiedFactor, resolvedMfaEnabled);
}

/**
 * Resolve the existing role/permission policy for another account before an admin
 * removes its MFA. This keeps the per-user switch from weakening mandatory MFA.
 */
export async function isMfaMandatoryForUser(env: Bindings, userId: string): Promise<boolean> {
  const admin = createAdminClient(env);
  const { data: roleRows, error: roleError } = await admin
    .from('user_roles')
    .select('roles!inner(key,status)')
    .eq('user_id', userId)
    .eq('roles.status', 'active');
  if (roleError) throw new Error('MFA_POLICY_TARGET_ROLE_LOOKUP_FAILED');

  const roleKeys = (roleRows ?? []).flatMap((row) => {
    const relation = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    return relation && typeof relation.key === 'string' ? [relation.key] : [];
  });
  if (roleKeys.some((key) => MFA_ADMIN_ROLE_KEYS.has(key) || MFA_APPROVER_ROLE_KEYS.has(key))) return true;

  const mandatoryPermissionKeys = [...MFA_APPROVAL_PERMISSION_KEYS, ...MFA_EXPORT_PERMISSION_KEYS];
  const recipients = await Promise.all(mandatoryPermissionKeys.map((key) => permissionRecipientIds(env, key)));
  return recipients.some((ids) => ids.includes(userId));
}
