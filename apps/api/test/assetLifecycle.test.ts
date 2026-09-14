import { describe, expect, it } from 'vitest';
import {
  ASSET_LIFECYCLE_STATUSES,
  allowedAssetLifecycleTransitions,
  canTransitionAssetLifecycle,
  isAssetLifecycleStatus,
  legacyStatusForLifecycle,
} from '../src/services/assetLifecycle';

describe('asset lifecycle', () => {
  it('exposes the complete lifecycle in order', () => {
    expect(ASSET_LIFECYCLE_STATUSES).toEqual([
      'ordered',
      'received',
      'ready',
      'checked_out',
      'repair',
      'returned',
      'disposed',
    ]);
  });

  it('allows only supported transitions', () => {
    expect(canTransitionAssetLifecycle('ordered', 'received')).toBe(true);
    expect(canTransitionAssetLifecycle('checked_out', 'repair')).toBe(true);
    expect(canTransitionAssetLifecycle('repair', 'ready')).toBe(false);
    expect(canTransitionAssetLifecycle('disposed', 'ready')).toBe(false);
    expect(allowedAssetLifecycleTransitions('returned')).toEqual(['ready', 'checked_out', 'disposed']);
  });

  it('validates values and keeps the legacy status mapping', () => {
    expect(isAssetLifecycleStatus('checked_out')).toBe(true);
    expect(isAssetLifecycleStatus('unknown')).toBe(false);
    expect(legacyStatusForLifecycle('checked_out')).toBeTypeOf('string');
    expect(legacyStatusForLifecycle('ordered')).toBeNull();
  });
});
