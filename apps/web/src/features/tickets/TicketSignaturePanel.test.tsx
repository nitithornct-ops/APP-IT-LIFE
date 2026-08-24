import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { TicketSignaturePanel } from './TicketSignaturePanel';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});

function renderPanel(props?: Partial<ComponentProps<typeof TicketSignaturePanel>>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><TicketSignaturePanel ticketId="ticket-1" signatureUrl={null} uploadedAt={null} canManage {...props} /></QueryClientProvider>);
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:signature') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TicketSignaturePanel', () => {
  it('accepts a PNG and uploads it to the Ticket signature endpoint', async () => {
    apiFetchMock.mockResolvedValue({ signatureUrl: 'https://signed.test/signature', uploadedAt: new Date().toISOString() });
    renderPanel();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'signature.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('ไฟล์ลายเซ็น PNG'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกลายเซ็น' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledOnce());
    const [path, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/tickets/ticket-1/signature');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('hides an empty signature panel from users who cannot edit the Ticket', () => {
    const { container } = renderPanel({ canManage: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('ให้ลบลายเซ็นของใบนี้ได้เสมอ เพราะไม่มีลายเซ็นกลางให้ตกทอดมาแล้ว', () => {
    renderPanel({ signatureUrl: 'https://signed.test/ticket.png' });
    expect(screen.getByRole('button', { name: 'ลบลายเซ็น' })).toBeInTheDocument();
    expect(screen.queryByText('กำลังใช้ลายเซ็นกลางของแบบฟอร์ม Ticket')).not.toBeInTheDocument();
  });
});
