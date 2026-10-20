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

  function renderForm(onClose = vi.fn()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><CreateTicketForm categories={[{ id: 'category-1', name: 'คอมพิวเตอร์', default_priority: 'ปานกลาง', response_sla_hours: 4, resolution_sla_hours: 24, sla_hours: 24, is_security_default: false, status: 'active', notes: null, created_at: '2026-10-19T00:00:00Z' }]} assets={[]} assetsLoading={false} requester={{ fullName: 'ผู้แจ้งทดสอบ', position: 'เจ้าหน้าที่', department: 'IT', phone: '1234' }} onClose={onClose} /></QueryClientProvider>);
    return onClose;
  }

  function fillRequiredFields() {
    fireEvent.change(screen.getByLabelText(/หัวข้อปัญหา/), { target: { value: 'เครื่องพิมพ์ใช้งานไม่ได้' } });
    fireEvent.change(screen.getByLabelText(/ประเภทงานที่ขอรับบริการ/), { target: { value: 'category-1' } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดปัญหา/), { target: { value: 'เชื่อมต่อเครื่องพิมพ์ไม่ได้' } });
  }

  it('keeps the form open on invalid input and associates errors with fields', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'เปิด Ticket' }));
    await waitFor(() => expect(screen.getByLabelText(/หัวข้อปัญหา/)).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText(/หัวข้อปัญหา/)).toHaveAccessibleDescription('กรุณากรอกหัวข้อปัญหา');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('asks before Escape discards entered data and keeps the body locked', async () => {
    const onClose = renderForm();
    fireEvent.change(screen.getByLabelText(/หัวข้อปัญหา/), { target: { value: 'งานที่ยังไม่ได้ส่ง' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'กลับไปแก้ไข' }));
    expect(screen.getByLabelText(/หัวข้อปัญหา/)).toHaveValue('งานที่ยังไม่ได้ส่ง');
  });

  it('closes an untouched form after field blur without a discard warning', async () => {
    const onClose = renderForm();
    fireEvent.blur(screen.getByLabelText(/หัวข้อปัญหา/));
    fireEvent.change(screen.getByLabelText('ระดับความรุนแรง'), { target: { value: '' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not close or submit again while a save is pending', async () => {
    apiFetchMock.mockImplementation(() => new Promise(() => {}));
    const onClose = renderForm();
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'เปิด Ticket' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'เปิด Ticket' })).toBeDisabled());
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a failed attachment on the created ticket without creating another ticket', async () => {
    apiFetchMock.mockResolvedValueOnce({ id: 'created-1' }).mockRejectedValueOnce(new Error('Upload failed')).mockResolvedValueOnce({});
    const onClose = renderForm();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('แนบหลักฐาน/ภาพหน้าจอ'), { target: { files: [new File(['test'], 'photo.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'เปิด Ticket' }));
    await screen.findByRole('alert');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ลองแนบไฟล์อีกครั้ง' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(apiFetchMock.mock.calls.filter(([url]) => url === '/api/v1/tickets')).toHaveLength(1);
    expect(apiFetchMock.mock.calls.filter(([url]) => url === '/api/v1/files')).toHaveLength(2);
    const retryBody = apiFetchMock.mock.calls[2]![1]!.body as FormData;
    expect(retryBody.get('targetId')).toBe('created-1');
  });
});
