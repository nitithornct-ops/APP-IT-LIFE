import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AccessRegistryPage } from './AccessRegistryPage';

const mocks = vi.hoisted(() => ({ api: vi.fn(), canManage: true }));
vi.mock('../../services/apiClient', async (load) => ({ ...(await load<typeof import('../../services/apiClient')>()), apiFetch: mocks.api }));
vi.mock('../../stores/authContext', () => ({ useAuth: () => ({ hasPermission: (key: string) => key === 'access_registry.manage' && mocks.canManage }) }));
vi.mock('./AccessCertificationCampaigns', () => ({ AccessCertificationCampaigns: () => <div>Campaigns</div> }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><AccessRegistryPage /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => { cleanup(); mocks.api.mockReset(); mocks.canManage = true; });

it('searches deactivation candidates through the dedicated endpoint', async () => {
  mocks.api.mockImplementation((url: string) => url.includes('deactivation-candidates')
    ? Promise.resolve([{ id: 'user-101', full_name: 'User 101', email: 'user101@test.local' }]) : Promise.resolve([]));
  renderPage();
  fireEvent.change(screen.getByLabelText('ค้นหาชื่อ อีเมล ชื่อบัญชี หรือรหัสพนักงาน'), { target: { value: 'user101' } });
  expect(await screen.findByRole('option', { name: 'User 101 (user101@test.local)' })).toBeVisible();
  expect(mocks.api).toHaveBeenCalledWith('/api/v1/access-registry/deactivation-candidates?search=user101');
});

it('shows a registry error instead of zero metrics when loading fails', async () => {
  mocks.canManage = false;
  mocks.api.mockRejectedValue(new Error('Registry unavailable'));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Registry unavailable');
  await waitFor(() => expect(screen.queryByText('สิทธิ์ในทะเบียน')).not.toBeInTheDocument());
});
