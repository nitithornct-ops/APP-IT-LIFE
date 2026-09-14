import { createAdminClient } from '../lib/supabase';
import type { Bindings } from '../types';

type PermissionEffect = 'allow' | 'deny';

export interface PermissionRecipientSnapshot {
  activeProfileIds: string[];
  roleAssignments: Array<{ userId: string; roleId: string }>;
  roleEffects: Array<{ roleId: string; effect: PermissionEffect }>;
  groupAssignments?: Array<{ userId: string; groupId: string }>;
  groupEffects?: Array<{ groupId: string; effect: PermissionEffect }>;
  overrides: Array<{ userId: string; effect: PermissionEffect }>;
}

/**
 * Apply the same precedence as public.has_permission(): an active user override wins,
 * otherwise any role deny wins over any role allow.
 */
export function resolvePermissionRecipientIds(snapshot: PermissionRecipientSnapshot): string[] {
  const activeProfiles = new Set(snapshot.activeProfileIds);
  const effectByRole = new Map(snapshot.roleEffects.map((row) => [row.roleId, row.effect]));
  const effectByGroup = new Map((snapshot.groupEffects ?? []).map((row) => [row.groupId, row.effect]));
  const roleState = new Map<string, { allow: boolean; deny: boolean }>();

  for (const assignment of snapshot.roleAssignments) {
    const effect = effectByRole.get(assignment.roleId);
    if (!effect) continue;
    const state = roleState.get(assignment.userId) ?? { allow: false, deny: false };
    state[effect] = true;
    roleState.set(assignment.userId, state);
  }

  for (const assignment of snapshot.groupAssignments ?? []) {
    const effect = effectByGroup.get(assignment.groupId);
    if (!effect) continue;
    const state = roleState.get(assignment.userId) ?? { allow: false, deny: false };
    state[effect] = true;
    roleState.set(assignment.userId, state);
  }

  const overrideState = new Map<string, PermissionEffect>();
  for (const override of snapshot.overrides) {
    const current = overrideState.get(override.userId);
    if (!current || override.effect === 'deny') overrideState.set(override.userId, override.effect);
  }

  return [...activeProfiles]
    .filter((userId) => {
      const override = overrideState.get(userId);
      if (override) return override === 'allow';
      const state = roleState.get(userId);
      return Boolean(state?.allow && !state.deny);
    })
    .sort();
}

/** Resolve every active profile that currently has the requested permission. */
export async function permissionRecipientIds(env: Bindings, permissionKey: string): Promise<string[]> {
  const admin = createAdminClient(env);
  const { data: permission, error: permissionError } = await admin
    .from('permissions')
    .select('id')
    .eq('key', permissionKey)
    .eq('status', 'active')
    .maybeSingle();
  if (permissionError) throw new Error(`permission_recipient_permission_failed: ${permissionError.message}`);
  if (!permission) return [];

  const now = new Date().toISOString();
  const [roleEffectResult, groupEffectResult, overrideResult] = await Promise.all([
    admin
      .from('role_permissions')
      .select('role_id,effect,roles!inner(status)')
      .eq('permission_id', permission.id)
      .eq('roles.status', 'active'),
    admin
      .from('access_group_permissions')
      .select('group_id,effect,access_groups!inner(status)')
      .eq('permission_id', permission.id)
      .eq('access_groups.status', 'active'),
    admin
      .from('user_permission_overrides')
      .select('user_id,effect')
      .eq('permission_id', permission.id)
      .eq('status', 'active')
      .eq('approval_status', 'approved')
      .or(`start_at.is.null,start_at.lte.${now}`)
      .or(`end_at.is.null,end_at.gte.${now}`),
  ]);
  const lookupError = roleEffectResult.error ?? groupEffectResult.error ?? overrideResult.error;
  if (lookupError) throw new Error(`permission_recipient_effects_failed: ${lookupError.message}`);

  const roleEffects = (roleEffectResult.data ?? []).map((row) => ({
    roleId: String(row.role_id),
    effect: row.effect as PermissionEffect,
  }));
  const groupEffects = (groupEffectResult.data ?? []).map((row) => ({
    groupId: String(row.group_id),
    effect: row.effect as PermissionEffect,
  }));
  const overrides = (overrideResult.data ?? []).map((row) => ({
    userId: String(row.user_id),
    effect: row.effect as PermissionEffect,
  }));
  const roleIds = [...new Set(roleEffects.map((row) => row.roleId))];
  const groupIds = [...new Set(groupEffects.map((row) => row.groupId))];

  const { data: assignmentRows, error: assignmentError } = roleIds.length
    ? await admin.from('user_roles').select('user_id,role_id').in('role_id', roleIds)
    : { data: [], error: null };
  if (assignmentError) throw new Error(`permission_recipient_roles_failed: ${assignmentError.message}`);

  const { data: groupAssignmentRows, error: groupAssignmentError } = groupIds.length
    ? await admin
      .from('access_group_members')
      .select('user_id,group_id,valid_from,valid_until,access_groups!inner(status)')
      .in('group_id', groupIds)
      .eq('status', 'active')
      .eq('access_groups.status', 'active')
      .or(`valid_from.is.null,valid_from.lte.${now}`)
      .or(`valid_until.is.null,valid_until.gte.${now}`)
    : { data: [], error: null };
  if (groupAssignmentError) throw new Error(`permission_recipient_groups_failed: ${groupAssignmentError.message}`);

  const roleAssignments = (assignmentRows ?? []).map((row) => ({
    userId: String(row.user_id),
    roleId: String(row.role_id),
  }));
  const groupAssignments = (groupAssignmentRows ?? []).map((row) => ({
    userId: String(row.user_id),
    groupId: String(row.group_id),
  }));
  const candidateIds = [...new Set([
    ...roleAssignments.map((row) => row.userId),
    ...groupAssignments.map((row) => row.userId),
    ...overrides.map((row) => row.userId),
  ])];
  if (!candidateIds.length) return [];

  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('status', 'active')
    .in('id', candidateIds);
  if (profileError) throw new Error(`permission_recipient_profiles_failed: ${profileError.message}`);

  return resolvePermissionRecipientIds({
    activeProfileIds: (profiles ?? []).map((row) => String(row.id)),
    roleAssignments,
    roleEffects,
    groupAssignments,
    groupEffects,
    overrides,
  });
}
