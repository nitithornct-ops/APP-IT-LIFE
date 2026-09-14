import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TechnicianSkillRecommendationResponse } from '../../types/technicianSkills';
import { TechnicianRecommendationPanel } from './TechnicianRecommendationPanel';

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

function renderPanel(onSelect = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { onSelect, ...render(
    <QueryClientProvider client={queryClient}>
      <TechnicianRecommendationPanel
        categoryId="11111111-1111-4111-8111-111111111111"
        location="สำนักงานใหญ่"
        productTechnology="Cisco"
        enabled
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  ) };
}

const response: TechnicianSkillRecommendationResponse = {
  category: { id: 'cat-net', name: 'เครือข่าย' },
  recommendations: [{
    technicianId: 'tech-1',
    name: 'ช่างหนึ่ง',
    email: 'tech-1@life.local',
    skill: 'Network Operations',
    proficiency: 4,
    certification: 'CCNA',
    certificationExpiry: '2027-12-31',
    productTechnology: 'Cisco',
    location: 'สำนักงานใหญ่',
    availability: 'available',
    workload: { open: 1, overdue: 0 },
    score: 85,
    reasons: ['Proficiency 4/5', 'พร้อมรับงาน', 'งานค้าง 1'],
  }],
  considered: 2,
  excluded: { unassessed: 1, belowMinimum: 0, unavailable: 0 },
  workloadSampled: false,
  generatedAt: '2026-09-13T00:00:00.000Z',
};

describe('TechnicianRecommendationPanel', () => {
  it('shows the workload-aware ranking and only selects after an explicit click', async () => {
    apiFetchMock.mockResolvedValue(response);
    const { onSelect } = renderPanel();

    await waitFor(() => expect(screen.getByText('ช่างหนึ่ง')).toBeInTheDocument());
    expect(screen.getByText('งานค้าง 1')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'เลือก ช่างหนึ่ง เป็นผู้รับผิดชอบ' }));
    expect(onSelect).toHaveBeenCalledWith('tech-1');
  });

  it('does not request or show suggestions when the caller cannot use the feature', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TechnicianRecommendationPanel categoryId="cat-net" location={null} productTechnology={null} enabled={false} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('technician-recommendations')).not.toBeInTheDocument();
  });
});
