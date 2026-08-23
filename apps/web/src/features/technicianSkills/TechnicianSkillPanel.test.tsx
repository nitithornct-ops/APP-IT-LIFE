import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TechnicianSkillProfile } from '../../types/technicianSkills';
import { TechnicianSkillPanel } from './TechnicianSkillPanel';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: mocks.apiFetch };
});
vi.mock('../../stores/authContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'technician_skill.manage' }),
}));

afterEach(() => {
  cleanup();
  mocks.apiFetch.mockReset();
});

const LEVELS = [
  { level: 1, label: 'ช่วยงานภายใต้การกำกับ', short: 'ช่วยงานได้' },
  { level: 2, label: 'ทำงานได้ด้วยตนเอง', short: 'ทำเองได้' },
  { level: 3, label: 'เชี่ยวชาญ/สอนงานได้', short: 'เชี่ยวชาญ' },
];

function makeProfile(overrides: Partial<TechnicianSkillProfile> = {}): TechnicianSkillProfile {
  return {
    technicianId: 'tech-1',
    skills: [
      { categoryId: 'cat-net', name: 'เครือข่าย', level: 3, note: 'ดูแล Core Switch', assessedAt: '2026-08-01T00:00:00.000Z', openTickets: 2 },
      { categoryId: 'cat-db', name: 'ฐานข้อมูล', level: null, note: null, assessedAt: null, openTickets: 1 },
    ],
    assessedCount: 1,
    averageLevel: 3,
    lastAssessedAt: '2026-08-01T00:00:00.000Z',
    workload: {
      open: 3,
      overdue: 1,
      dueToday: 0,
      unassessedCategories: 1,
      byStatus: [{ label: 'กำลังดำเนินการ', value: 2 }, { label: 'รออะไหล่', value: 1 }],
    },
    performance: {
      months: [
        { key: '2026-03', label: 'มี.ค.', closed: 2, slaMet: 2, slaPercent: 100, averageRating: 5 },
        { key: '2026-04', label: 'เม.ย.', closed: 0, slaMet: 0, slaPercent: null, averageRating: null },
        { key: '2026-05', label: 'พ.ค.', closed: 4, slaMet: 3, slaPercent: 75, averageRating: 4.5 },
        { key: '2026-06', label: 'มิ.ย.', closed: 1, slaMet: 1, slaPercent: 100, averageRating: null },
        { key: '2026-07', label: 'ก.ค.', closed: 3, slaMet: 2, slaPercent: 66.7, averageRating: 4 },
        { key: '2026-08', label: 'ส.ค.', closed: 5, slaMet: 5, slaPercent: 100, averageRating: 4.8 },
      ],
      closedTotal: 15,
      slaPercent: 86.7,
      averageRating: 4.6,
      ratedCount: 9,
    },
    levels: LEVELS,
    workloadAvailable: true,
    canManage: true,
    generatedAt: '2026-08-23T10:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(technicianId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TechnicianSkillPanel technicianId={technicianId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TechnicianSkillPanel', () => {
  it('renders assessed levels, workload and six months of real performance', async () => {
    mocks.apiFetch.mockResolvedValue(makeProfile());
    renderPanel();

    await waitFor(() => expect(screen.getByText('เครือข่าย')).toBeInTheDocument());
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/technician-skills/me');
    expect(screen.getByText('ดูแล Core Switch')).toBeInTheDocument();
    expect(screen.getByText('ประเมินแล้ว 1/2 หมวด', { exact: false })).toBeInTheDocument();
    // หมวดที่ยังไม่ประเมินต้องแสดงขีดกลาง ไม่ใช่ 0
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('ถืองานค้างอยู่ 1 หมวดที่ยังไม่เคยถูกประเมิน', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('86.7%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /งานที่ปิดต่อเดือน/ })).toBeInTheDocument();
  });

  it('states plainly that nothing has been assessed instead of showing invented scores', async () => {
    mocks.apiFetch.mockResolvedValue(
      makeProfile({
        skills: [{ categoryId: 'cat-net', name: 'เครือข่าย', level: null, note: null, assessedAt: null, openTickets: 0 }],
        assessedCount: 0,
        averageLevel: null,
        lastAssessedAt: null,
        workload: { open: 0, overdue: 0, dueToday: 0, unassessedCategories: 0, byStatus: [] },
      }),
    );
    renderPanel();

    await waitFor(() => expect(screen.getByText(/ยังไม่มีการประเมินระดับทักษะของบัญชีนี้/)).toBeInTheDocument());
    expect(screen.getByText('ไม่มี Ticket ที่ยังเปิดค้างอยู่')).toBeInTheDocument();
  });

  it('says workload is out of scope rather than reporting a misleading zero', async () => {
    mocks.apiFetch.mockResolvedValue(makeProfile({ workloadAvailable: false }));
    renderPanel('tech-9');

    await waitFor(() => expect(screen.getAllByText(/ticket\.view_all/).length).toBe(2));
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/technician-skills/tech-9');
    expect(screen.queryByText('งานค้าง')).not.toBeInTheDocument();
  });

  it('offers a retry when the request fails', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('เครือข่ายขัดข้อง'));
    renderPanel();

    await waitFor(() => expect(screen.getByText('โหลดตารางทักษะไม่สำเร็จ')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /ลองใหม่/ })).toBeInTheDocument();
  });
});
