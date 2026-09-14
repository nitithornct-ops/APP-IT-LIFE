import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetVerificationPage } from './AssetVerificationPage';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: mocks.apiFetch };
});
vi.mock('../../stores/authContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'asset.update' }),
}));

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  localStorage.clear();
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockImplementation((path: string) => {
    if (path === '/api/v1/assets/field/campaigns') return Promise.resolve([{
      id: 'campaign-1', campaign_code: 'FSC-2569-01', name: 'ตรวจนับทรัพย์สินปี 2569', planned_date: '2026-09-12', location: 'อาคาร A', status: 'active', completed_at: null, verificationCount: 0,
    }]);
    if (path === '/api/v1/employees/options') return Promise.resolve([]);
    if (path.startsWith('/api/v1/assets/field/resolve')) return Promise.resolve({
      id: 'asset-1', assetCode: 'AS-001', name: 'Notebook ฝ่ายบัญชี', assetType: 'Endpoint', serialNumber: 'SN-001', location: 'อาคาร A', ownerEmployeeId: null, ownerName: null,
    });
    return Promise.resolve({ savedCount: 1, verifications: [{ id: 'verification-1', clientRef: 'client-1', assetId: 'asset-1' }] });
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><AssetVerificationPage /></MemoryRouter></QueryClientProvider>);
}

describe('AssetVerificationPage', () => {
  it('shows campaign, scanner and batch verification outcomes', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('option', { name: /ตรวจนับทรัพย์สินปี 2569/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('พิมพ์รหัสทรัพย์สินเอง'), { target: { value: 'AS-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));

    await waitFor(() => expect(screen.getByText('Notebook ฝ่ายบัญชี')).toBeInTheDocument());
    expect(screen.getByLabelText('ผลตรวจ AS-001')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ผู้ถือครองผิด' })).toBeInTheDocument();
    expect(screen.getByLabelText('สถานที่พบจริง AS-001')).toHaveValue('อาคาร A');
  });

  it('keeps the scan queue usable when the browser is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('ออฟไลน์')).toBeInTheDocument());
    expect(screen.getByText(/สแกนต่อได้/)).toBeInTheDocument();
  });
});
