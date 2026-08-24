import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillMatrixResponse } from '../../types/technicianSkills';
import { TechnicianSkillMatrixPage } from './TechnicianSkillMatrixPage';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: mocks.apiFetch };
});

afterEach(() => {
  cleanup();
  mocks.apiFetch.mockReset();
});

const LEVELS = [
  { level: 1, label: 'ช่วยงานภายใต้การกำกับ', short: 'ช่วยงานได้' },
  { level: 2, label: 'ทำงานได้ด้วยตนเอง', short: 'ทำเองได้' },
  { level: 3, label: 'เชี่ยวชาญ/สอนงานได้', short: 'เชี่ยวชาญ' },
];

function makeMatrix(overrides: Partial<SkillMatrixResponse> = {}): SkillMatrixResponse {
  return {
    categories: [{ id: 'cat-net', name: 'เครือข่าย' }, { id: 'cat-db', name: 'ฐานข้อมูล' }],
    technicians: [
      {
        id: 'tech-1',
        name: 'วรุณ ทองแท้',
        email: 'warun@life.local',
        cells: [
          { categoryId: 'cat-net', level: 3, note: 'ดูแล Core Switch', assessedAt: '2026-08-01T00:00:00.000Z', openTickets: 2 },
          { categoryId: 'cat-db', level: null, note: null, assessedAt: null, openTickets: 0 },
        ],
        assessedCount: 1,
        averageLevel: 3,
        openTickets: 2,
        overdueTickets: 1,
        unassessedOpenCategories: 0,
      },
    ],
    coverage: [
      { categoryId: 'cat-net', name: 'เครือข่าย', assessed: 1, independent: 1, expert: 1, openTickets: 2, risk: 'single' },
      { categoryId: 'cat-db', name: 'ฐานข้อมูล', assessed: 0, independent: 0, expert: 0, openTickets: 3, risk: 'uncovered' },
    ],
    summary: {
      technicianCount: 1,
      categoryCount: 2,
      assessedCells: 1,
      totalCells: 2,
      coveragePercent: 50,
      uncoveredCategories: 1,
      singlePointCategories: 1,
      openTicketsAtRisk: 5,
    },
    lastAssessedAt: '2026-08-01T00:00:00.000Z',
    levels: LEVELS,
    workloadAvailable: true,
    workloadSampled: false,
    canManage: true,
    generatedAt: '2026-08-23T10:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TechnicianSkillMatrixPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TechnicianSkillMatrixPage', () => {
  it('shows the grid plus the coverage risks that actually drive assignment decisions', async () => {
    mocks.apiFetch.mockResolvedValue(makeMatrix());
    renderPage();

    await waitFor(() => expect(screen.getByText('วรุณ ทองแท้')).toBeInTheDocument());
    expect(screen.getByText('ยังไม่มีผู้รับงาน')).toBeInTheDocument();
    expect(screen.getByText('พึ่งพาคนเดียว')).toBeInTheDocument();
    expect(screen.getByText('หมวดที่ไม่มีผู้รับงาน')).toBeInTheDocument();
    expect(screen.getByText('งานค้าง 2 · เกินกำหนด 1')).toBeInTheDocument();
    // ช่องที่ยังไม่ประเมินต้องอ่านออกว่า "ยังไม่ประเมิน" ไม่ใช่คะแนนศูนย์
    expect(screen.getAllByText('ยังไม่ประเมิน').length).toBeGreaterThan(0);
  });

  it('hides the assessment action when the account may only view', async () => {
    mocks.apiFetch.mockResolvedValue(makeMatrix({ canManage: false }));
    renderPage();

    await waitFor(() => expect(screen.getByText('วรุณ ทองแท้')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /ประเมินทักษะของ/ })).not.toBeInTheDocument();
  });

  it('sends the withdrawn category as an explicit null rather than level zero', async () => {
    mocks.apiFetch.mockResolvedValue(makeMatrix());
    renderPage();

    await waitFor(() => expect(screen.getByText('วรุณ ทองแท้')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'ประเมินทักษะของ วรุณ ทองแท้' }));

    await waitFor(() => expect(screen.getByText(/ระบุระดับที่ประเมินได้จริงเท่านั้น/)).toBeInTheDocument());
    const networkGroup = screen.getByRole('group', { name: 'ระดับทักษะหมวด เครือข่าย' });
    fireEvent.click(within(networkGroup).getByRole('button', { name: /ยังไม่ประเมิน/ }));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกผลประเมิน' }));

    await waitFor(() => expect(mocks.apiFetch.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(true));
    const [path, init] = mocks.apiFetch.mock.calls.find((call) => call[1]?.method === 'PUT')!;
    expect(path).toBe('/api/v1/technician-skills/tech-1');
    expect(JSON.parse(String(init.body)).skills).toEqual([
      { categoryId: 'cat-net', level: null, note: 'ดูแล Core Switch' },
      { categoryId: 'cat-db', level: null },
    ]);
  });

  it('points to Master Data when no ticket category exists to assess against', async () => {
    mocks.apiFetch.mockResolvedValue(
      makeMatrix({
        categories: [],
        technicians: [],
        coverage: [],
        summary: { technicianCount: 0, categoryCount: 0, assessedCells: 0, totalCells: 0, coveragePercent: null, uncoveredCategories: 0, singlePointCategories: 0, openTicketsAtRisk: 0 },
        lastAssessedAt: null,
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('ยังไม่มีหมวดหมู่งานให้ประเมิน')).toBeInTheDocument());
  });
});
