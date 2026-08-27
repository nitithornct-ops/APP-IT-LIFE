import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateTicketForm } from './TicketsPage';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

describe('CreateTicketForm', () => {
  it('submits section 1 data without requesting a signature before the work is complete', async () => {
    apiFetchMock.mockResolvedValueOnce({ id: 'ticket-1' });
    const onClose = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CreateTicketForm
          categories={[{ id: '11111111-1111-4111-8111-111111111111', name: 'ระบบ ERP', default_priority: 'ปานกลาง', response_sla_hours: 4, resolution_sla_hours: 24, sla_hours: 24, is_security_default: false, status: 'active', notes: null, created_at: '2026-08-26T00:00:00.000Z' }]}
          assets={[]}
          assetsLoading={false}
          requester={{ fullName: 'สมชาย ใจดี', position: 'นักบัญชี', department: 'การเงิน', phone: '0812345678' }}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument();
    expect(screen.getByText('นักบัญชี')).toBeInTheDocument();
    expect(screen.getByText('การเงิน')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/หัวข้อปัญหา/), { target: { value: 'เข้า ERP ไม่ได้' } });
    fireEvent.change(screen.getByLabelText(/ประเภทงานที่ขอรับบริการ/), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.change(screen.getByLabelText('ERP Module (ถ้ามี)'), { target: { value: 'Finance' } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดปัญหา/), { target: { value: 'ระบบแจ้ง Access denied' } });
    fireEvent.click(screen.getByRole('button', { name: 'เปิด Ticket' }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const createBody = JSON.parse(apiFetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(createBody).toMatchObject({
      title: 'เข้า ERP ไม่ได้',
      requesterPhone: '0812345678',
      erpModule: 'Finance',
      description: 'ระบบแจ้ง Access denied',
    });
    expect(createBody.incidentAt).toEqual(expect.any(String));
    expect(screen.queryByText('ลายเซ็นผู้แจ้ง')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
