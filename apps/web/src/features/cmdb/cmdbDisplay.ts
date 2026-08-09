import type { CiStatus, RelationshipStatus } from '../../types/cmdb';

export {
  CI_CRITICALITIES,
  CI_DATA_CLASSIFICATIONS,
  CI_ENVIRONMENTS,
  CI_NODE_TYPES_ENABLED,
  CI_STATUSES,
  CI_TYPES,
  RELATIONSHIP_DIRECTIONS,
  RELATIONSHIP_IMPACT_LEVELS,
  RELATIONSHIP_STATUSES,
  RELATIONSHIP_TYPES_ENABLED,
} from '../../types/cmdb';

export const ciStatusTone: Record<CiStatus, 'success' | 'primary' | 'warning' | 'secondary' | 'danger'> = {
  Draft: 'secondary',
  Active: 'success',
  Maintenance: 'primary',
  Degraded: 'warning',
  Retired: 'danger',
};

export const relationshipStatusTone: Record<RelationshipStatus, 'success' | 'secondary'> = {
  Active: 'success',
  Inactive: 'secondary',
};

export const criticalityTone: Record<string, 'secondary' | 'primary' | 'warning' | 'danger'> = {
  Low: 'secondary',
  Medium: 'primary',
  High: 'warning',
  Critical: 'danger',
};

export function employeeName(e: { first_name_th: string; last_name_th: string; nickname?: string | null } | null | undefined): string {
  if (!e) return '—';
  const name = `${e.first_name_th} ${e.last_name_th}`.trim();
  return e.nickname ? `${name} (${e.nickname})` : name;
}
