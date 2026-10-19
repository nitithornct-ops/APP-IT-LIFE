import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeDetailPage } from './changes/ChangeDetailPage';
import { ChangesPage } from './changes/ChangesPage';
import { ProblemDetailPage } from './problems/ProblemDetailPage';
import { ProblemsPage } from './problems/ProblemsPage';
import { ServiceRequestDetailPage } from './serviceRequests/ServiceRequestDetailPage';
import { ServiceRequestsPage } from './serviceRequests/ServiceRequestsPage';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../services/apiClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/apiClient')>(),
  apiFetch: mocks.apiFetch,
}));
vi.mock('../stores/authContext', () => ({
  useAuth: () => ({ me: { profile: { id: 'viewer' } }, hasPermission: () => false, isMeLoading: false }),
}));

const timestamp = '2026-10-01T08:00:00Z';
const change = { id: 'change-1', title: 'เปลี่ยนเครื่องแม่ข่าย', change_number: 'CHG-001', status: 'ยื่นคำขอ', risk_level: 'ต่ำ', requester_id: 'requester', system_affected: 'ERP', request_date: timestamp, created_at: timestamp };
const problem = { id: 'problem-1', title: 'วิเคราะห์ระบบเครือข่าย', problem_number: 'PRB-001', status: 'เปิด', priority: 'สูง', created_at: timestamp, recurrence_count: 0, problem_incidents: [], problem_tickets: [], problem_configuration_items: [], problem_changes: [], corrective_actions: [] };
const request = { id: 'request-1', service_name: 'ขอเครื่องคอมพิวเตอร์', service_code: 'SR-001', status: 'กำลังดำเนินการ', priority: 'วิกฤต', requester_id: 'requester', due_at: timestamp, created_at: timestamp, summary: 'รายละเอียดคำขอ', tasks: [], history: [], attachments: [], cycle_time: { approvalMinutes: 5, fulfillmentMinutes: null } };
const paginated = (item?: object) => ({ items: item ? [item] : [], pagination: { page: 1, pageSize: 100, totalItems: item ? 1 : 0, totalPages: 1 } });
const clients: QueryClient[] = [];

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="current-location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>ย้อนประวัติ</button></>;
}

function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><LocationProbe /><Routes>
    <Route path="/changes" element={<ChangesPage />} /><Route path="/changes/:id" element={<ChangeDetailPage />} />
    <Route path="/problems" element={<ProblemsPage />} /><Route path="/problems/:id" element={<ProblemDetailPage />} />
    <Route path="/service-requests" element={<ServiceRequestsPage />} /><Route path="/service-requests/:id" element={<ServiceRequestDetailPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  mocks.apiFetch.mockReset();
});

describe('module list navigation', () => {
  it('keeps Change filters when opening a detail and returning to the list', async () => {
    mocks.apiFetch.mockImplementation(async (path: string) => path === '/api/v1/changes/change-1' ? { change, attachments: [], relationships: [] } : paginated(change));
    mount('/changes?search=ERP&status=ยื่นคำขอ&risk=ต่ำ');
    await screen.findByRole('link', { name: change.title });
    fireEvent.change(screen.getByLabelText('กรองความเสี่ยง'), { target: { value: 'สูง' } });
    fireEvent.click(await screen.findByRole('link', { name: change.title }));
    await screen.findByRole('heading', { name: change.title });
    fireEvent.click(screen.getByRole('button', { name: 'กลับไป Change Management' }));
    await waitFor(() => expect(screen.getByLabelText('กรองความเสี่ยง')).toHaveValue('สูง'));
    expect(screen.getByLabelText('ค้นหารายการ')).toHaveValue('ERP');
    expect(screen.getByLabelText('กรองสถานะ')).toHaveValue('ยื่นคำขอ');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Problem filters after returning from its detail', async () => {
    mocks.apiFetch.mockImplementation(async (path: string) => path.startsWith('/api/v1/problems/known-errors') ? paginated() : path === '/api/v1/problems/problem-1' ? { problem, knownErrors: [], attachments: [] } : paginated(problem));
    mount('/problems?search=เครือข่าย&status=เปิด&priority=สูง');
    fireEvent.click(await screen.findByRole('link', { name: problem.title }));
    await screen.findByRole('heading', { name: problem.title });
    fireEvent.click(screen.getByRole('link', { name: 'กลับไปรายการ Problem' }));
    await waitFor(() => expect(screen.getByLabelText('ค้นหารายการ')).toHaveValue('เครือข่าย'));
    expect(screen.getByLabelText('กรองสถานะ')).toHaveValue('เปิด');
    expect(screen.getByLabelText('กรองความเร่งด่วน')).toHaveValue('สูง');
  });

  it('restores the Service Request tab with back navigation and uses the same priority color in list and detail', async () => {
    mocks.apiFetch.mockImplementation(async (path: string) => path.startsWith('/api/v1/service-catalog') ? paginated() : path === '/api/v1/service-requests/request-1' ? request : paginated(request));
    mount('/service-requests?tab=all');
    await screen.findByRole('link', { name: request.service_name });
    expect(screen.getByText('วิกฤต').closest('[data-ui="badge"]')).toHaveAttribute('data-tone', 'danger');
    fireEvent.click(screen.getByRole('button', { name: 'คำขอของฉัน (1)' }));
    expect(screen.getByTestId('current-location')).toHaveTextContent('tab=mine');
    fireEvent.click(screen.getByRole('button', { name: 'ย้อนประวัติ' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'คำขอทั้งหมด (1)' })).toHaveAttribute('aria-current', 'page'));
    fireEvent.click(screen.getByRole('link', { name: request.service_name }));
    await screen.findByRole('heading', { name: request.service_name });
    expect(screen.getByText('วิกฤต').closest('[data-ui="badge"]')).toHaveAttribute('data-tone', 'danger');
    fireEvent.click(screen.getByRole('link', { name: 'กลับไปรายการคำขอบริการ' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'คำขอทั้งหมด (1)' })).toHaveAttribute('aria-current', 'page'));
    expect(screen.getByTestId('current-location')).toHaveTextContent('/service-requests?tab=all');
  });
});
