import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PmRosterResponse } from '../../types/assets';
import { PmRosterPanel } from './PmRosterView';

afterEach(cleanup);

const data: PmRosterResponse = {
  weekStart: '2026-08-17',
  weekEnd: '2026-08-23',
  days: ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'].map((date, index) => ({ date, label: ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'][index], total: index < 2 ? 1 : 0, unassigned: index === 1 ? 1 : 0 })),
  summary: { total: 2, assigned: 1, unassigned: 1, completed: 0, overdue: 1 },
  technicians: [{
    id: 'tech-1', name: 'วรุณ ทองแท้', total: 1, completed: 0, inProgress: 0, overdue: 1, dayCounts: [1, 0, 0, 0, 0, 0, 0],
    plans: [{ id: 'pm-1', planDate: '2026-08-17', status: 'วางแผน', recurrence: 'รายเดือน', assetCode: 'UPS-01', assetName: 'UPS ห้อง Server', technicianId: 'tech-1', technicianName: 'วรุณ ทองแท้', overdueDays: 0 }],
  }],
  unassignedPlans: [{ id: 'pm-2', planDate: '2026-08-18', status: 'วางแผน', recurrence: 'รายปี', assetCode: 'FW-01', assetName: 'Firewall', technicianId: null, technicianName: 'ยังไม่ระบุผู้รับผิดชอบ', overdueDays: 0 }],
  overduePlans: [{ id: 'late-1', planDate: '2026-08-10', status: 'วางแผน', recurrence: 'รายไตรมาส', assetCode: 'SW-02', assetName: 'Core Switch', technicianId: 'tech-1', technicianName: 'วรุณ ทองแท้', overdueDays: 10 }],
  overdueSampled: false,
};

describe('PmRosterPanel', () => {
  it('shows weekly technician workload, unassigned PM and overdue work from real data', () => {
    render(<PmRosterPanel data={data} />);

    expect(screen.getByText('ภาระงาน PM รายช่าง')).toBeInTheDocument();
    expect(screen.getByText('วรุณ ทองแท้')).toBeInTheDocument();
    expect(screen.getByText(/UPS-01 · UPS ห้อง Server/)).toBeInTheDocument();
    expect(screen.getByText(/FW-01 · Firewall/)).toBeInTheDocument();
    expect(screen.getByText('งาน PM ที่เลยกำหนด')).toBeInTheDocument();
    expect(screen.getByText(/SW-02 · Core Switch/)).toBeInTheDocument();
    expect(screen.getByText(/ระบบยังไม่มีข้อมูลเวรรับสาย วันลา และ Change window/)).toBeInTheDocument();
  });
});
