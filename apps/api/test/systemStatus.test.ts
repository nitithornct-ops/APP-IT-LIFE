import { describe, expect, it } from 'vitest';
import { computeUptimePercent, SYSTEM_STATUS_COMPONENTS } from '../src/services/systemStatusService';

describe('system status metrics', () => {
  it('computes uptime from measured samples and excludes not-configured samples', () => {
    expect(computeUptimePercent({
      sampleCount: 100,
      operationalCount: 98,
      degradedCount: 1,
      downCount: 1,
      notConfiguredCount: 0,
      averageResponseTimeMs: 120,
    })).toBe(98);

    expect(computeUptimePercent({
      sampleCount: 10,
      operationalCount: 0,
      degradedCount: 0,
      downCount: 0,
      notConfiguredCount: 10,
      averageResponseTimeMs: null,
    })).toBeNull();
  });

  it('keeps the requested component inventory and marks optional integrations non-critical', () => {
    expect(SYSTEM_STATUS_COMPONENTS.map((component) => component.id)).toEqual([
      'api', 'database', 'supabase_auth', 'storage', 'cloudflare_worker',
      'line_messaging', 'smtp', 'google_drive', 'scheduled_jobs', 'outbox_queue',
    ]);
    expect(SYSTEM_STATUS_COMPONENTS.find((component) => component.id === 'database')?.critical).toBe(true);
    expect(SYSTEM_STATUS_COMPONENTS.find((component) => component.id === 'smtp')?.critical).toBe(false);
  });
});
