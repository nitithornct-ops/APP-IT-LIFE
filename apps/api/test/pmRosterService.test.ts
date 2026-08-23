import { describe, expect, it } from 'vitest';
import { buildPmRoster } from '../src/services/pmRosterService';
import { pmRosterQuerySchema } from '../src/validators/maintenance';

const technician = { id: 'tech-1', first_name_th: 'วรุณ', last_name_th: 'ทองแท้' };

describe('PM technician roster', () => {
  it('groups a real seven-day PM schedule by technician and highlights unassigned work', () => {
    const roster = buildPmRoster({
      weekStart: '2026-08-17',
      today: '2026-08-20',
      weekRows: [
        { id: 'pm-1', plan_date: '2026-08-17', status: 'วางแผน', recurrence: 'รายเดือน', technician_id: 'tech-1', technician, asset: { asset_code: 'UPS-01', name: 'UPS ห้อง Server' } },
        { id: 'pm-2', plan_date: '2026-08-18', status: 'ดำเนินการแล้ว', recurrence: 'ครั้งเดียว', technician_id: 'tech-1', technician: [technician], asset: [{ asset_code: 'SW-01', name: 'Core Switch' }] },
        { id: 'pm-3', plan_date: '2026-08-19', status: 'วางแผน', recurrence: 'รายปี', technician_id: null, technician: null, asset: { asset_code: 'FW-01', name: 'Firewall' } },
        { id: 'cancelled', plan_date: '2026-08-20', status: 'ยกเลิก', recurrence: 'ครั้งเดียว', technician_id: null, asset: { asset_code: 'X', name: 'ยกเลิก' } },
      ],
      overdueRows: [],
    });

    expect(roster.weekEnd).toBe('2026-08-23');
    expect(roster.summary).toEqual({ total: 3, assigned: 2, unassigned: 1, completed: 1, overdue: 0 });
    expect(roster.technicians[0]).toMatchObject({ id: 'tech-1', name: 'วรุณ ทองแท้', total: 2, completed: 1, dayCounts: [1, 1, 0, 0, 0, 0, 0] });
    expect(roster.unassignedPlans[0]).toMatchObject({ id: 'pm-3', assetName: 'Firewall' });
  });

  it('keeps overdue-only technicians visible and preserves the exact overdue count', () => {
    const roster = buildPmRoster({
      weekStart: '2026-08-17',
      today: '2026-08-20',
      weekRows: [],
      overdueRows: [{ id: 'late-1', plan_date: '2026-08-10', status: 'กำลังดำเนินการ', recurrence: 'รายไตรมาส', technician_id: 'tech-1', technician, asset: { asset_code: 'UPS-02', name: 'UPS สาขา' } }],
      overdueTotal: 1002,
    });

    expect(roster.summary.overdue).toBe(1002);
    expect(roster.overdueSampled).toBe(true);
    expect(roster.technicians[0]).toMatchObject({ total: 0, overdue: 1 });
    expect(roster.overduePlans[0].overdueDays).toBe(10);
  });

  it('validates the roster week start query', () => {
    expect(pmRosterQuerySchema.safeParse({ weekStart: '2026-08-17' }).success).toBe(true);
    expect(pmRosterQuerySchema.safeParse({ weekStart: '17/08/2026' }).success).toBe(false);
  });
});
