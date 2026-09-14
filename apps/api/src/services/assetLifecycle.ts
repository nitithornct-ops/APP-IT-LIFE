export const ASSET_LIFECYCLE_STATUSES = [
  'ordered',
  'received',
  'ready',
  'checked_out',
  'repair',
  'returned',
  'disposed',
] as const;

export type AssetLifecycleStatus = (typeof ASSET_LIFECYCLE_STATUSES)[number];

export const ASSET_LIFECYCLE_LABELS: Record<AssetLifecycleStatus, string> & Record<string, string> = {
  ordered: 'สั่งซื้อ',
  received: 'รับเข้า',
  ready: 'พร้อมใช้',
  checked_out: 'เบิกจ่าย',
  repair: 'ซ่อม',
  returned: 'รับคืน',
  disposed: 'จำหน่าย',
};

const TRANSITIONS: Record<AssetLifecycleStatus, readonly AssetLifecycleStatus[]> = {
  ordered: ['received'],
  received: ['ready'],
  ready: ['checked_out', 'disposed'],
  checked_out: ['repair', 'returned'],
  repair: ['returned'],
  returned: ['ready', 'checked_out', 'disposed'],
  disposed: [],
};

export function isAssetLifecycleStatus(value: unknown): value is AssetLifecycleStatus {
  return typeof value === 'string' && (ASSET_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

export function canTransitionAssetLifecycle(from: AssetLifecycleStatus, to: AssetLifecycleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedAssetLifecycleTransitions(from: AssetLifecycleStatus): AssetLifecycleStatus[] {
  return [...TRANSITIONS[from]];
}

/** Map the lifecycle to the legacy status used by existing Asset workflows. */
export function legacyStatusForLifecycle(status: AssetLifecycleStatus): string | null {
  switch (status) {
    case 'checked_out':
      return 'ใช้งานอยู่';
    case 'repair':
      return 'ซ่อมบำรุง';
    case 'disposed':
      return 'จำหน่าย/เลิกใช้';
    case 'ready':
    case 'received':
    case 'returned':
      return 'พร้อมใช้งาน';
    case 'ordered':
      return null;
  }
}
