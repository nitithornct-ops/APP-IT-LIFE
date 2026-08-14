import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicTicketPortalPage } from './PublicTicketPortalPage';

const { lineApiFetchMock, publicTicketApiFetchMock } = vi.hoisted(() => ({
  lineApiFetchMock: vi.fn(),
  publicTicketApiFetchMock: vi.fn(),
}));

vi.mock('../services/lineApiClient', () => ({
  getLineSessionToken: () => 'active-line-session',
  lineApiFetch: lineApiFetchMock,
}));

vi.mock('../services/publicTicketApiClient', () => ({
  publicTicketApiFetch: publicTicketApiFetchMock,
}));

beforeEach(() => {
  publicTicketApiFetchMock.mockResolvedValue({
    enabled: true,
    categories: [],
    priorities: [],
    privacy: { version: 'test', summary: '', dpoContact: '' },
  });
  lineApiFetchMock.mockImplementation((path: string) => {
    if (path === '/api/v1/line/bootstrap') {
      return Promise.resolve({ authenticated: true, profile: { fullName: 'สมชาย ใจดี', linkStatus: 'Active' } });
    }
    if (path === '/api/v1/line/tickets') {
      return Promise.resolve([
        {
          id: 'ticket-1',
          ticket_no: 'TCK-2026-0001',
          title: 'เครื่องพิมพ์ใช้งานไม่ได้',
          priority: 'ปานกลาง',
          status: 'กำลังดำเนินการ',
          created_at: '2026-08-13T03:00:00.000Z',
          category: { name: 'อุปกรณ์สำนักงาน' },
        },
      ]);
    }
    return Promise.reject(new Error(`Unexpected LINE API path: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PublicTicketPortalPage LINE status list', () => {
  it('shows the logged-in LINE user tickets as a table', async () => {
    render(<MemoryRouter><PublicTicketPortalPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'ติดตามสถานะ' }));

    expect(await screen.findByRole('table')).toBeVisible();
    expect(screen.getByText('รายการแจ้งซ่อมของฉัน')).toBeVisible();
    expect(screen.getByText('TCK-2026-0001')).toBeVisible();
    expect(screen.getByText('เครื่องพิมพ์ใช้งานไม่ได้')).toBeVisible();
    expect(screen.getByText('อุปกรณ์สำนักงาน')).toBeVisible();
    expect(screen.getByText('กำลังดำเนินการ')).toBeVisible();
    expect(lineApiFetchMock).toHaveBeenCalledWith('/api/v1/line/tickets');
  });
});
