import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetFieldSummary } from '../../types/fieldWork';
import { AssetScanPage } from './AssetScanPage';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), navigate: vi.fn() }));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: mocks.apiFetch };
});
vi.mock('../../stores/authContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'ticket.create' }),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return { ...original, useNavigate: () => mocks.navigate };
});

afterEach(() => {
  cleanup();
  mocks.apiFetch.mockReset();
  mocks.navigate.mockReset();
});

function makeSummary(overrides: Partial<AssetFieldSummary> = {}): AssetFieldSummary {
  return {
    asset: {
      id: 'asset-1',
      assetCode: 'AS-NB-2608ABC',
      name: 'Notebook ฝ่ายบัญชี',
      assetType: 'Notebook',
      brand: 'Dell',
      model: 'Latitude 5440',
      serialNumber: 'SN-12345',
      location: 'ชั้น 3 ห้องบัญชี',
      status: 'ใช้งาน',
      warrantyExpire: '2027-01-31',
      warrantyActive: true,
      categoryName: 'คอมพิวเตอร์พกพา',
      ownerName: 'นาย สมชาย ใจดี',
    },
    repeatRepair: { windowDays: 90, threshold: 3, count: 1, isRepeat: false, lastRepairedAt: null },
    openTickets: [],
    history: [],
    historyScope: 'organization',
    historySampled: false,
    generatedAt: '2026-08-23T10:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssetScanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function lookupWith(code: string) {
  fireEvent.change(screen.getByLabelText(/พิมพ์รหัสทรัพย์สินเอง/), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
}

describe('AssetScanPage', () => {
  it('always offers manual entry so a phone without camera scanning still works', () => {
    renderPage();
    expect(screen.getByLabelText(/พิมพ์รหัสทรัพย์สินเอง/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /เปิดกล้องสแกน QR/ })).toBeInTheDocument();
  });

  it('shows the machine and its history after a successful lookup', async () => {
    mocks.apiFetch.mockResolvedValue(
      makeSummary({
        history: [{
          id: 'ticket-9', ticketNo: 'TCK-009', title: 'เปิดเครื่องไม่ติด', status: 'ปิดงาน', priority: 'ปานกลาง',
          createdAt: '2026-08-01T03:00:00.000Z', closedAt: '2026-08-02T03:00:00.000Z', dueAt: null, overdue: false,
          assigneeName: 'ช่างวรุณ',
        }],
      }),
    );
    renderPage();
    await lookupWith('AS-NB-2608ABC');

    await waitFor(() => expect(screen.getByText('Notebook ฝ่ายบัญชี')).toBeInTheDocument());
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/assets/lookup?code=AS-NB-2608ABC');
    expect(screen.getByText('SN-12345')).toBeInTheDocument();
    expect(screen.getByText('ในประกัน')).toBeInTheDocument();
    expect(screen.getByText('เปิดเครื่องไม่ติด')).toBeInTheDocument();
  });

  it('raises the repeat-repair alarm only when the API says the threshold was reached', async () => {
    mocks.apiFetch.mockResolvedValue(
      makeSummary({ repeatRepair: { windowDays: 90, threshold: 3, count: 3, isRepeat: true, lastRepairedAt: '2026-08-02T03:00:00.000Z' } }),
    );
    renderPage();
    await lookupWith('AS-NB-2608ABC');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ซ่อมซ้ำ 3 ครั้ง'));
  });

  it('says the history may be incomplete when the account cannot see every ticket', async () => {
    mocks.apiFetch.mockResolvedValue(makeSummary({ historyScope: 'personal' }));
    renderPage();
    await lookupWith('AS-NB-2608ABC');

    await waitFor(() => expect(screen.getByText('เห็นเฉพาะใบที่ท่านเกี่ยวข้อง')).toBeInTheDocument());
    expect(screen.getByText(/เครื่องนี้อาจเคยซ่อมโดยช่างคนอื่น/)).toBeInTheDocument();
  });

  it('carries the scanned machine into the existing ticket form instead of a separate one', async () => {
    mocks.apiFetch.mockResolvedValue(makeSummary());
    renderPage();
    await lookupWith('AS-NB-2608ABC');

    await waitFor(() => expect(screen.getByRole('button', { name: /เปิดใบงานกับเครื่องนี้/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /เปิดใบงานกับเครื่องนี้/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/tickets?newForAsset=asset-1');
  });

  it('reports a code that is not in the register instead of showing an empty machine card', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('ไม่พบทรัพย์สินรหัส AS-NOPE ในระบบ'));
    renderPage();
    await lookupWith('AS-NOPE');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ไม่พบทรัพย์สินรหัส AS-NOPE ในระบบ'));
    expect(screen.getByLabelText(/พิมพ์รหัสทรัพย์สินเอง/)).toBeInTheDocument();
  });
});
