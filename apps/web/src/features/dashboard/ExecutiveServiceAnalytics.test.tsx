import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutiveServiceAnalytics as Analytics } from '../../types/dashboard';
import { ExecutiveServiceAnalytics } from './ExecutiveServiceAnalytics';

afterEach(cleanup);

const data: Analytics = {
  periodDays: 30,
  sampled: false,
  kpis: { received: 18, slaClosedPercent: 92.4, averageResponseMinutes: 14, averageResolutionHours: 5.8, csatAverage: 4.62, csatResponses: 12 },
  heatmap: {
    hours: Array.from({ length: 12 }, (_, index) => index + 8),
    days: Array.from({ length: 7 }, (_, index) => ({ key: `2026-08-${17 + index}`, label: ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'][index], total: index === 0 ? 3 : 0, values: Array.from({ length: 12 }, (_, hourIndex) => index === 0 && hourIndex === 1 ? 3 : 0) })),
    maximum: 3,
    peak: { dayLabel: 'จ.', hour: 9, count: 3 },
  },
  openByStatus: [{ label: 'กำลังดำเนินการ', value: 4 }, { label: 'รออะไหล่', value: 2 }],
  backlogAge: [{ key: 'under1', label: '<1 วัน', value: 1 }, { key: 'days1to3', label: '1–3 วัน', value: 2 }, { key: 'days4to7', label: '4–7 วัน', value: 1 }, { key: 'over7', label: '>7 วัน', value: 2 }],
  categories: [{ label: 'ฮาร์ดแวร์', value: 8 }, { label: 'เครือข่าย', value: 5 }],
  technicians: [{ name: 'อนันต์ พ.', closed: 7, slaPercent: 95, averageRating: 4.8 }],
};

describe('ExecutiveServiceAnalytics', () => {
  it('renders real KPI, 7x12 heatmap, backlog and technician ranking', () => {
    render(<ExecutiveServiceAnalytics data={data} />);

    expect(screen.getByRole('heading', { name: 'ภาพรวมงานบริการ IT' })).toBeInTheDocument();
    expect(screen.getByText('92.4%')).toBeInTheDocument();
    expect(screen.getByLabelText('2026-08-17 เวลา 9 นาฬิกา 3 ใบ')).toBeInTheDocument();
    expect(screen.getByText(/ช่วงพีคจริงอยู่วัน/)).toBeInTheDocument();
    expect(screen.getByText('งานค้างตามสถานะ')).toBeInTheDocument();
    expect(screen.getByText('ฮาร์ดแวร์')).toBeInTheDocument();
    expect(screen.getByText('อนันต์ พ.')).toBeInTheDocument();
  });
});
