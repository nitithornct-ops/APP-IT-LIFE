import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketRatingCriteriaSetting } from './TicketRatingCriteriaSetting';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});

function renderSetting() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><TicketRatingCriteriaSetting canManage /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TicketRatingCriteriaSetting', () => {
  it('lists current criteria and lets an administrator add another topic', async () => {
    apiFetchMock.mockImplementation((path: string) => Promise.resolve(
      path.includes('includeInactive')
        ? [{ id: 'criterion-1', key: 'responsiveness', label: 'ความรวดเร็ว', description: null, sort_order: 10, status: 'active' }]
        : { id: 'criterion-2' },
    ));
    renderSetting();
    expect(await screen.findByDisplayValue('ความรวดเร็ว')).toBeVisible();
    fireEvent.change(screen.getByLabelText('หัวข้อประเมินใหม่'), { target: { value: 'ความสะอาดหลังซ่อม' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มหัวข้อ' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/ticket-rating-criteria', {
      method: 'POST',
      body: JSON.stringify({ label: 'ความสะอาดหลังซ่อม', description: undefined }),
    }));
  });
});

