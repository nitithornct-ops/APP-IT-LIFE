import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineNotificationCard } from './LineNotificationCard';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/apiClient')>()),
  apiFetch: apiFetchMock,
}));

const linkedAccount = {
  id: 'line-1',
  displayName: 'สมชาย',
  pictureUrl: '',
  fullName: 'สมชาย ใจดี',
  linkStatus: 'Active',
  friendStatus: 'Friend',
  linkedAt: '2026-09-05T02:30:00.000Z',
};

beforeEach(() => {
  vi.stubGlobal('location', { href: 'http://localhost/profile' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderCard(entry = '/profile') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}>
        <LineNotificationCard />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LineNotificationCard', () => {
  it('lets an unlinked user start LINE Login without waiting for an administrator', async () => {
    apiFetchMock.mockImplementation((path: string) => (path.startsWith('/api/v1/line/login-url')
      ? Promise.resolve({ url: 'http://localhost:8787/api/v1/line/login-start?returnMode=link' })
      : Promise.resolve({ available: true, unavailableReason: '', account: null })));
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: /เชื่อมบัญชี LINE ของฉัน/ }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/line/login-url?returnMode=link'));
    await waitFor(() => expect(window.location.href).toBe('http://localhost:8787/api/v1/line/login-start?returnMode=link'));
  });

  it('warns that pushes cannot arrive while the user is not a LINE OA friend', async () => {
    apiFetchMock.mockResolvedValue({
      available: true, unavailableReason: '', account: { ...linkedAccount, friendStatus: 'Blocked' },
    });
    renderCard();

    expect(await screen.findByText(/ปลดบล็อกเพื่อให้ข้อความส่งถึง/)).toBeVisible();
    expect(screen.getByRole('button', { name: /ยกเลิกการเชื่อมบัญชี/ })).toBeVisible();
  });

  it('unlinks on request so the user can move the notifications to another LINE account', async () => {
    apiFetchMock.mockResolvedValue({ available: true, unavailableReason: '', account: linkedAccount });
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: /ยกเลิกการเชื่อมบัญชี/ }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/line/my-link', { method: 'DELETE' }));
  });

  it('explains why linking is closed instead of offering a button that cannot work', async () => {
    apiFetchMock.mockResolvedValue({
      available: false, unavailableReason: 'LINE Login ยังไม่เปิดใช้งาน', account: null,
    });
    renderCard();

    expect(await screen.findByText(/LINE Login ยังไม่เปิดใช้งาน/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /เชื่อมบัญชี LINE ของฉัน/ })).not.toBeInTheDocument();
  });

  it('confirms the result of the round trip the callback page just completed', async () => {
    apiFetchMock.mockResolvedValue({ available: true, unavailableReason: '', account: linkedAccount });
    renderCard('/profile?line=linked');

    expect(await screen.findByText(/เชื่อมบัญชี LINE เรียบร้อยแล้ว/)).toBeVisible();
  });
});
