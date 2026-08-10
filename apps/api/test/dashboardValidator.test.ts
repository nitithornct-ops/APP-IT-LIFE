import { describe, expect, it } from 'vitest';
import { dashboardSummaryQuerySchema } from '../src/validators/dashboard';

describe('dashboard summary validator', () => {
  it('defaults the warning lead time to 30 days', () => {
    expect(dashboardSummaryQuerySchema.parse({}).leadDays).toBe(30);
  });

  it('coerces valid query values', () => {
    expect(dashboardSummaryQuerySchema.parse({ leadDays: '60' }).leadDays).toBe(60);
  });

  it('rejects values outside 7 to 90 days', () => {
    expect(dashboardSummaryQuerySchema.safeParse({ leadDays: 6 }).success).toBe(false);
    expect(dashboardSummaryQuerySchema.safeParse({ leadDays: 91 }).success).toBe(false);
  });
});

