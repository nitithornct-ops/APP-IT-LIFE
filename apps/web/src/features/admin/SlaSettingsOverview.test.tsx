import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SlaImpactResponse } from '../../types/settings';
import { SlaImpactPanel } from './SlaSettingsOverview';

afterEach(cleanup);

const impact: SlaImpactResponse = {
  generatedAt: '2026-08-23T06:00:00.000Z',
  calendar: { start: '08:30', end: '17:30', businessDays: [1, 2, 3, 4, 5], holidays: ['2026-12-05'], minutesPerDay: 540 },
  policies: [{ id: 'category-1', name: 'อุปกรณ์คอมพิวเตอร์', priority: 'ปานกลาง', responseHours: 4, resolutionHours: 24 }],
  current: { total: 8, overdue: 1, critical: 1, atRisk: 2, safe: 3, paused: 1, unconfigured: 0 },
  proposed: { total: 8, overdue: 2, critical: 1, atRisk: 1, safe: 3, paused: 1, unconfigured: 0 },
  changes: { newlyOverdue: 1, newlyAtRisk: 0, deadlineChanged: 7, preservedReopened: 1 },
};

describe('SlaImpactPanel', () => {
  it('shows the real calendar, policies and before/after queue impact', () => {
    render(<SlaImpactPanel data={impact} />);

    expect(screen.getByText('SLA & เวลาทำการ')).toBeInTheDocument();
    expect(screen.getByText('08:30–17:30')).toBeInTheDocument();
    expect(screen.getByText('อุปกรณ์คอมพิวเตอร์')).toBeInTheDocument();
    expect(screen.getByText('ถ้าบันทึกค่าชุดนี้')).toBeInTheDocument();
    expect(screen.getByText('ผลต่อ Ticket เปิด 8 รายการ')).toBeInTheDocument();
    expect(screen.getByText('กำหนดเสร็จเปลี่ยน')).toBeInTheDocument();
    expect(screen.getByText(/Ticket ที่เคยเปิดซ้ำ 1 รายการ/)).toBeInTheDocument();
  });
});
