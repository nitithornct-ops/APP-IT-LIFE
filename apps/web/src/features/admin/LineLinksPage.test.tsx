import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineLinksPage } from './LineLinksPage';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../services/apiClient', () => ({ apiFetch: apiFetchMock }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LineLinksPage /></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

describe('LineLinksPage', () => {
  it('ให้ผู้ดูแลเลือกผู้ใช้และเชื่อมกับบัญชี LINE ได้', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/v1/line/admin/link-options') {
        return Promise.resolve([{
          id: '11111111-1111-4111-8111-111111111111', employee_code: 'EMP-001',
          full_name: 'สมชาย ใจดี', email: 'somchai@example.com', status: 'active', linked_line_user_id: null,
        }]);
      }
      if (path.startsWith('/api/v1/line/admin/links') && !path.endsWith('/link')) {
        return Promise.resolve([{
          id: '22222222-2222-4222-8222-222222222222', display_name: 'Somchai LINE', full_name: 'สมชาย ใจดี',
          linked_user_id: null, link_status: 'Active', friend_status: 'Friend', last_login_at: '2026-08-27T03:00:00.000Z',
        }]);
      }
      return Promise.resolve({});
    });
    renderPage();

    const select = await screen.findByRole('combobox', { name: 'เลือกผู้ใช้สำหรับ สมชาย ใจดี' });
    fireEvent.change(select, { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/line/admin/links/22222222-2222-4222-8222-222222222222/link',
      { method: 'PATCH', body: JSON.stringify({ userId: '11111111-1111-4111-8111-111111111111' }) },
    ));
  });
});
