import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketFormPage } from './TicketFormPage';
import type { TicketFormDocument } from '../../types/tickets';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});

const CONTENT_HTML = '<h1>แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP</h1><h2>ส่วนที่ 1: ข้อมูลผู้แจ้ง</h2><p>TCK-001 · สมชาย ใจดี</p><p>☐ คอมพิวเตอร์ ☐ เครื่องพิมพ์</p><p>หมายเหตุ —</p><h2>ส่วนที่ 2: การประเมินโดย IT</h2><p>เจ้าหน้าที่ IT</p><h2>ส่วนที่ 3: การแก้ไขโดย Vendor</h2><p>รอตอบกลับ</p><h2>ส่วนที่ 4: Manday / Credit</h2><h2>ส่วนที่ 5: ปิดงาน</h2><img src="https://signed.test/ticket-1.png" alt="ลายเซ็นรับรอง Ticket">';

function formDocument(overrides: Partial<TicketFormDocument> = {}): TicketFormDocument {
  return {
    ticketId: 'ticket-1', ticketNo: 'TCK-001', ticketStatus: 'ส่งต่อ Outsource',
    template: { id: 'template-1', code: 'IT-ERP-ISSUE', name: 'แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP', version: 2, source: 'issue', updatedAt: '2026-08-19T02:00:00.000Z' },
    issueForm: { id: 'form-1', formNo: 'FRM-001', status: 'Sent to Vendor' },
    pageSettings: { size: 'A4', orientation: 'portrait', marginMm: 20 },
    contentHtml: CONTENT_HTML,
    checkmarks: [1],
    textValues: {},
    canEditCheckmarks: true,
    canEditContent: true,
    isCustomized: false,
    flow: [
      { section: 1, title: 'ข้อมูลผู้แจ้ง', state: 'complete', detail: 'ข้อมูลจาก Ticket' },
      { section: 2, title: 'IT ประเมินและดำเนินการ', state: 'complete', detail: 'ส่งต่อ Vendor/Outsource แล้ว' },
      { section: 3, title: 'Vendor แก้ไข', state: 'current', detail: 'รอ Vendor ตอบกลับ' },
      { section: 4, title: 'Manday / Credit', state: 'current', detail: 'บันทึกพร้อมผลตอบกลับ Vendor' },
      { section: 5, title: 'ตรวจรับและปิดงาน', state: 'pending', detail: 'ดำเนินการหลังแก้ไขเสร็จ' },
    ],
    ...overrides,
  } as TicketFormDocument;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/tickets/ticket-1/form']}><Routes><Route path="/tickets/:id/form" element={<TicketFormPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

/**
 * jsdom ไม่คำนวณ layout ทุกความสูงจึงเป็น 0 และเอกสารทั้งใบจะลงหน้าเดียวเสมอ
 * ป้อนความสูงคงที่ให้ทุก element เพื่อบังคับให้ตัวจัดหน้าต้องแบ่งหน้าจริง
 */
function stubBlockHeight(heightPx: number) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    height: heightPx, width: 640, top: 0, left: 0, right: 640, bottom: heightPx, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); apiFetchMock.mockReset(); });

describe('TicketFormPage', () => {
  it('renders the Form Studio template and its five-section flow for the Ticket', async () => {
    apiFetchMock.mockResolvedValue(formDocument());
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderPage();
    const form = await screen.findByTestId('ticket-form-page');
    expect(form).toHaveTextContent('TCK-001');
    expect(form).toHaveTextContent('สมชาย ใจดี');
    expect(screen.getByText(/IT-ERP-ISSUE/)).toHaveTextContent('แบบฟอร์มการแจ้งปัญหา IT Support และระบบ ERP');
    expect(screen.getAllByText('รอ Vendor ตอบกลับ')).toHaveLength(1);
    expect(screen.getByText('ส่วนที่ 5: ปิดงาน')).toBeInTheDocument();
    expect(screen.getByAltText('ลายเซ็นรับรอง Ticket')).toHaveAttribute('src', 'https://signed.test/ticket-1.png');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'false');
    expect(checkboxes[1]).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(checkboxes[0]!);
    expect(screen.getAllByRole('checkbox')[0]).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/form-checkmarks', {
      method: 'PATCH',
      body: JSON.stringify({ templateId: 'template-1', templateVersion: 2, indices: [0, 1], textValues: {} }),
    }));
    const textField = screen.getByRole('textbox', { name: 'กรอกข้อความช่องที่ 1' });
    textField.textContent = 'ข้อความเพิ่มเติม';
    fireEvent.blur(textField);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/form-checkmarks', {
      method: 'PATCH',
      body: JSON.stringify({ templateId: 'template-1', templateVersion: 2, indices: [0, 1], textValues: { 0: 'ข้อความเพิ่มเติม' } }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ / บันทึก PDF' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
  });

  it('แสดงเอกสารเป็นแผ่นกระดาษ และบอกจำนวนหน้าที่จะพิมพ์ออกมา', async () => {
    apiFetchMock.mockResolvedValue(formDocument());
    renderPage();
    await screen.findByTestId('ticket-form-page');
    await waitFor(() => expect(screen.getAllByTestId('ticket-form-sheet').length).toBeGreaterThan(0));
    expect(screen.getByText(/แบ่งเป็น 1 หน้า ขนาด A4/)).toBeVisible();
  });

  it('แบ่งเอกสารยาวออกเป็นหลายแผ่นตามความสูงจริงของเนื้อหา', async () => {
    stubBlockHeight(400);
    apiFetchMock.mockResolvedValue(formDocument());
    renderPage();
    await screen.findByTestId('ticket-form-page');
    // พื้นที่เนื้อหา A4 ขอบ 20 มม. สูงราว 971px จึงลงได้ 2 block ต่อหน้า
    await waitFor(() => expect(screen.getAllByTestId('ticket-form-sheet').length).toBeGreaterThan(1));
    expect(screen.getByText(/แบ่งเป็น \d+ หน้า/)).toBeVisible();
  });

  it('ให้แต่ละแผ่นมีป้ายบอกลำดับหน้าเพื่อให้ผู้ใช้ตรวจก่อนพิมพ์ได้', async () => {
    stubBlockHeight(400);
    apiFetchMock.mockResolvedValue(formDocument());
    renderPage();
    await screen.findByTestId('ticket-form-page');
    await waitFor(() => expect(screen.getAllByTestId('ticket-form-sheet').length).toBeGreaterThan(1));
    const sheets = screen.getAllByTestId('ticket-form-sheet');
    expect(sheets[0]).toHaveAttribute('aria-label', `หน้า 1 จาก ${sheets.length}`);
  });

  it('ซ่อนปุ่มแก้ไขจากผู้ที่ไม่มีสิทธิ์แก้ Ticket', async () => {
    apiFetchMock.mockResolvedValue(formDocument({ canEditContent: false }));
    renderPage();
    await screen.findByTestId('ticket-form-page');
    expect(screen.queryByRole('button', { name: /แก้ไขและจัดรูป/ })).not.toBeInTheDocument();
  });

  it('เตือนเรื่องเอกสารหยุดอัปเดตก่อน แล้วจึงบันทึกเอกสารที่จัดรูปเองไว้กับ Ticket ใบนี้', async () => {
    apiFetchMock.mockResolvedValue(formDocument());
    renderPage();
    await screen.findByTestId('ticket-form-page');

    fireEvent.click(screen.getByRole('button', { name: /แก้ไขและจัดรูป/ }));
    expect(screen.getByRole('textbox', { name: 'พื้นที่แก้ไขแบบฟอร์ม' })).toBeVisible();
    expect(screen.getByText(/หยุดอัปเดตตามข้อมูล Ticket และแม่แบบ/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'แทรกตัวแบ่งหน้ากระดาษ' })).toBeVisible();

    apiFetchMock.mockResolvedValueOnce({ contentHtml: CONTENT_HTML, isCustomized: true });
    fireEvent.click(screen.getByRole('button', { name: /บันทึกแบบฟอร์ม/ }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/tickets/ticket-1/form-content',
      expect.objectContaining({ method: 'PATCH' }),
    ));
  });

  it('เสนอปุ่มคืนค่าจากแม่แบบเฉพาะเมื่อ Ticket ใบนี้ใช้เอกสารที่จัดรูปเองอยู่', async () => {
    apiFetchMock.mockResolvedValue(formDocument({ isCustomized: true }));
    renderPage();
    await screen.findByTestId('ticket-form-page');
    expect(screen.getByText('แก้ไขเฉพาะใบนี้')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /แก้ไขและจัดรูป/ }));
    apiFetchMock.mockResolvedValueOnce({ isCustomized: false });
    fireEvent.click(screen.getByRole('button', { name: /คืนค่าจากแม่แบบ/ }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/tickets/ticket-1/form-content',
      { method: 'DELETE' },
    ));
  });

  it('ออกจากโหมดแก้ไขได้โดยไม่บันทึกอะไรเลย', async () => {
    apiFetchMock.mockResolvedValue(formDocument());
    renderPage();
    await screen.findByTestId('ticket-form-page');

    fireEvent.click(screen.getByRole('button', { name: /แก้ไขและจัดรูป/ }));
    fireEvent.click(screen.getByRole('button', { name: /ยกเลิก/ }));

    await waitFor(() => expect(screen.getByTestId('ticket-form-page')).toBeVisible());
    expect(apiFetchMock).not.toHaveBeenCalledWith('/api/v1/tickets/ticket-1/form-content', expect.anything());
  });
});
