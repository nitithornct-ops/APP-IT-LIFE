import { describe, expect, it } from 'vitest';
import { resolvePermissionRecipientIds } from '../src/services/permissionRecipientService';

describe('resolvePermissionRecipientIds', () => {
  it('includes active users with an allowed role and removes duplicates', () => {
    expect(resolvePermissionRecipientIds({
      activeProfileIds: ['user-b', 'user-a'],
      roleAssignments: [
        { userId: 'user-a', roleId: 'admin' },
        { userId: 'user-a', roleId: 'technician' },
        { userId: 'user-b', roleId: 'admin' },
      ],
      roleEffects: [
        { roleId: 'admin', effect: 'allow' },
        { roleId: 'technician', effect: 'allow' },
      ],
      overrides: [],
    })).toEqual(['user-a', 'user-b']);
  });

  it('applies deny-over-allow for roles and lets a current user override take precedence', () => {
    expect(resolvePermissionRecipientIds({
      activeProfileIds: ['role-denied', 'override-allowed', 'override-denied'],
      roleAssignments: [
        { userId: 'role-denied', roleId: 'allow-role' },
        { userId: 'role-denied', roleId: 'deny-role' },
        { userId: 'override-allowed', roleId: 'deny-role' },
        { userId: 'override-denied', roleId: 'allow-role' },
        { userId: 'inactive', roleId: 'allow-role' },
      ],
      roleEffects: [
        { roleId: 'allow-role', effect: 'allow' },
        { roleId: 'deny-role', effect: 'deny' },
      ],
      overrides: [
        { userId: 'override-allowed', effect: 'allow' },
        { userId: 'override-denied', effect: 'deny' },
      ],
    })).toEqual(['override-allowed']);
  });

  it('allows a user-level override even when the user has no role assignment', () => {
    expect(resolvePermissionRecipientIds({
      activeProfileIds: ['direct-user'],
      roleAssignments: [],
      roleEffects: [],
      overrides: [{ userId: 'direct-user', effect: 'allow' }],
    })).toEqual(['direct-user']);
  });
});
