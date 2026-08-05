import { describe, expect, it } from 'vitest';
import { hasAllPermissions, hasAnyPermission, hasPermission } from './check';

describe('hasPermission', () => {
  it('returns true when the key is present', () => {
    expect(hasPermission(['ticket.view', 'ticket.create'], 'ticket.view')).toBe(true);
  });

  it('returns false when the key is missing', () => {
    expect(hasPermission(['ticket.view'], 'ticket.create')).toBe(false);
  });
});

describe('hasAnyPermission', () => {
  it('returns true when at least one required key is present', () => {
    expect(hasAnyPermission(['ticket.view'], ['ticket.create', 'ticket.view'])).toBe(true);
  });

  it('returns false when none of the required keys are present', () => {
    expect(hasAnyPermission(['ticket.view'], ['asset.view', 'asset.create'])).toBe(false);
  });
});

describe('hasAllPermissions', () => {
  it('returns true only when every required key is present', () => {
    expect(hasAllPermissions(['ticket.view', 'ticket.create'], ['ticket.view', 'ticket.create'])).toBe(true);
    expect(hasAllPermissions(['ticket.view'], ['ticket.view', 'ticket.create'])).toBe(false);
  });
});
