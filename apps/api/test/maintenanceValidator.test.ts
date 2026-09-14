import { describe, expect, it } from 'vitest';
import {
  cancelMaintenanceSchema,
  listMaintenancePlansQuerySchema,
  recordMaintenanceResultSchema,
  rescheduleMaintenanceSchema,
} from '../src/validators/maintenance';
import { computeNextPmDate } from '../src/routes/maintenance';

const ID = '11111111-1111-4111-8111-111111111111';

describe('PM integrity validators and scheduling', () => {
  it('keeps an unanswered checklist item explicit and requires a result before closing', () => {
    expect(recordMaintenanceResultSchema.safeParse({ status: 'ดำเนินการแล้ว', checklistResults: [{ text: 'ตรวจเครื่อง' }] }).success).toBe(true);
    expect(recordMaintenanceResultSchema.safeParse({ status: 'ยกเลิก' }).success).toBe(false);
  });

  it('requires reasons for rescheduling and cancellation', () => {
    expect(rescheduleMaintenanceSchema.safeParse({ planDate: '2026-09-20' }).success).toBe(false);
    expect(cancelMaintenanceSchema.safeParse({}).success).toBe(false);
    expect(rescheduleMaintenanceSchema.safeParse({ planDate: '2026-09-20', reason: 'ผู้รับผิดชอบติดภารกิจ' }).success).toBe(true);
    expect(cancelMaintenanceSchema.safeParse({ reason: 'ยกเลิกตามคำขอหน่วยงาน' }).success).toBe(true);
  });

  it('validates date ranges and searches on the server-side contract', () => {
    expect(listMaintenancePlansQuerySchema.safeParse({ assetId: ID, recurrence: 'รายเดือน', planDateFrom: '2026-09-20', planDateTo: '2026-09-01' }).success).toBe(false);
    expect(listMaintenancePlansQuerySchema.safeParse({ search: 'UPS', planDateFrom: '2026-09-01', planDateTo: '2026-09-30' }).success).toBe(true);
  });

  it('clamps month-end dates instead of rolling into the following month', () => {
    expect(computeNextPmDate('2026-01-31', 'รายเดือน')).toBe('2026-02-28');
    expect(computeNextPmDate('2026-11-30', 'รายไตรมาส')).toBe('2027-02-28');
    expect(computeNextPmDate('2026-02-28', 'รายปี')).toBe('2027-02-28');
  });
});
