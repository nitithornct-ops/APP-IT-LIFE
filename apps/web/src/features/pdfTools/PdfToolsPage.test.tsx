import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfToolsPage } from './PdfToolsPage';

/**
 * pdf.js ต้องใช้ canvas จริงและ worker ซึ่ง jsdom ไม่มี — แทนด้วยตัวสร้างภาพย่อปลอม
 * เทสต์นี้จึงตรวจ "หน้าจอต่อพื้นที่ทำงานถูกไหม" ส่วนความถูกต้องของไฟล์ PDF อยู่ใน pdfDocumentEngine.test.ts
 */
vi.mock('./pdfThumbnails', () => ({
  createThumbnailRenderer: vi.fn(async () => ({
    render: vi.fn(async () => 'data:image/png;base64,fake'),
    destroy: vi.fn(),
  })),
}));

/** สำเนาไบต์ลง ArrayBuffer ของตัวเอง เพื่อให้ชนิดตรงกับที่ File รับได้โดยไม่ต้อง cast */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function pdfFile(name: string, pageCount: number): Promise<File> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage([200, 400]);
  return new File([toArrayBuffer(await document.save())], name, { type: 'application/pdf' });
}

/**
 * ใช้ StrictMode เหมือน main.tsx จริง — React จะเรียก state updater ซ้ำสองครั้ง เทสต์ชุดนี้จึงจับ
 * บั๊กแบบ "กดย้อนกลับแล้วไม่มีอะไรเกิดขึ้น" ที่เกิดเฉพาะตอนเก็บประวัติไว้ในฟังก์ชัน updater ได้
 */
function renderPage() {
  return render(
    <StrictMode>
      <MemoryRouter>
        <PdfToolsPage />
      </MemoryRouter>
    </StrictMode>,
  );
}

async function addFile(file: File) {
  fireEvent.change(screen.getByLabelText('เลือกไฟล์ PDF หรือรูปภาพ'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getAllByTestId('pdf-page-card').length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PdfToolsPage', () => {
  it('บอกตั้งแต่หัวหน้าจอว่าไฟล์ไม่ถูกส่งออกจากเครื่อง', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'เครื่องมือจัดการ PDF' })).toBeVisible();
    expect(screen.getByText('ประมวลผลในเครื่อง ไม่ส่งไฟล์ขึ้นระบบ')).toBeVisible();
  });

  it('แสดงสถานะว่างพร้อมทางไปต่อเมื่อยังไม่มีไฟล์', () => {
    renderPage();
    expect(screen.getByText('ยังไม่มีไฟล์ในพื้นที่ทำงาน')).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('เปิดไฟล์ PDF แล้วสร้างการ์ดครบทุกหน้า', async () => {
    renderPage();
    await addFile(await pdfFile('รายงาน.pdf', 3));
    expect(screen.getAllByTestId('pdf-page-card')).toHaveLength(3);
    expect(screen.getByRole('tablist', { name: 'เครื่องมือจัดการ PDF' })).toBeVisible();
  });

  it('ลบหน้าที่เลือกออกจากพื้นที่ทำงาน และย้อนกลับได้', async () => {
    renderPage();
    await addFile(await pdfFile('รายงาน.pdf', 3));

    fireEvent.click(screen.getByRole('checkbox', { name: 'เลือกหน้า 2' }));
    fireEvent.click(screen.getByRole('button', { name: /ลบที่เลือก/ }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-card')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /ย้อนกลับ/ }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-card')).toHaveLength(3));
  });

  it('ย้อนกลับทีละขั้นจนกลับไปสถานะเริ่มต้น', async () => {
    renderPage();
    await addFile(await pdfFile('รายงาน.pdf', 4));

    fireEvent.click(screen.getByRole('button', { name: 'ลบหน้า 1' }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-card')).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'ลบหน้า 1' }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-card')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /ย้อนกลับ/ }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-card')).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: /ย้อนกลับ/ }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-card')).toHaveLength(4));
    expect(screen.getByRole('button', { name: /ย้อนกลับ/ })).toBeDisabled();
  });

  it('ย้ายหน้าด้วยปุ่มลูกศรได้โดยไม่ต้องลากวาง', async () => {
    renderPage();
    await addFile(await pdfFile('รายงาน.pdf', 2));

    // ติดป้ายหน้าแรกไว้ด้วยการเลือก แล้วดูว่าหลังย้ายไปท้ายสุด ป้ายนั้นตามไปด้วย
    fireEvent.click(screen.getByRole('checkbox', { name: 'เลือกหน้า 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'ย้ายหน้า 1 ไปถัดไป' }));

    await waitFor(() => {
      const cards = screen.getAllByTestId('pdf-page-card');
      expect(within(cards[1]).getByRole('checkbox', { name: 'เลือกหน้า 2' })).toBeChecked();
      expect(within(cards[0]).getByRole('checkbox', { name: 'เลือกหน้า 1' })).not.toBeChecked();
    });
  });

  it('ทำสำเนาหน้าเดียวแล้วนับหน้ารวมเพิ่มขึ้น', async () => {
    renderPage();
    await addFile(await pdfFile('รายงาน.pdf', 2));

    fireEvent.click(screen.getByRole('button', { name: 'ทำสำเนาหน้า 1' }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-card')).toHaveLength(3));
  });

  it('บอกจำนวนไฟล์ที่จะได้จากการแยกก่อนกดดาวน์โหลด', async () => {
    renderPage();
    await addFile(await pdfFile('รายงาน.pdf', 3));

    fireEvent.click(screen.getByRole('tab', { name: 'แยกไฟล์' }));
    expect(screen.getByText('ไฟล์ 1: หน้า 1 (1 หน้า)')).toBeVisible();
    expect(screen.getByRole('button', { name: /ดาวน์โหลด 3 ไฟล์/ })).toBeEnabled();

    fireEvent.change(screen.getByLabelText(/จำนวนหน้าต่อไฟล์/), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /ดาวน์โหลด 2 ไฟล์/ })).toBeVisible());
  });

  it('อธิบายช่วงหน้าที่พิมพ์ผิดแทนที่จะปล่อยให้กดดาวน์โหลด', async () => {
    renderPage();
    await addFile(await pdfFile('รายงาน.pdf', 3));

    fireEvent.click(screen.getByRole('tab', { name: 'แยกไฟล์' }));
    fireEvent.change(screen.getByLabelText(/วิธีแยก/), { target: { value: 'ranges' } });
    fireEvent.change(screen.getByLabelText(/ช่วงหน้า/), { target: { value: '1-9' } });

    await waitFor(() => expect(screen.getByText(/เอกสารมี 3 หน้า/)).toBeVisible());
    expect(screen.getByRole('button', { name: /ดาวน์โหลด 0 ไฟล์/ })).toBeDisabled();
  });

  it('แสดงตัวอย่างข้อความเลขหน้าตามรูปแบบที่เลือก', async () => {
    renderPage();
    await addFile(await pdfFile('รายงาน.pdf', 4));

    fireEvent.click(screen.getByRole('tab', { name: 'ลายน้ำและเลขหน้า' }));
    expect(screen.getByText('1 / 4')).toBeVisible();

    fireEvent.change(screen.getByLabelText(/รูปแบบ/), { target: { value: 'thai' } });
    await waitFor(() => expect(screen.getByText('หน้า 1 จาก 4')).toBeVisible());
  });

  it('อธิบายเป็นภาษาไทยเมื่อเปิดไฟล์ที่ไม่ใช่ PDF', async () => {
    renderPage();
    const broken = new File([new Uint8Array([1, 2, 3])], 'พัง.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('เลือกไฟล์ PDF หรือรูปภาพ'), { target: { files: [broken] } });

    await waitFor(() => expect(screen.getByText(/เปิดไฟล์ "พัง.pdf" ไม่ได้/)).toBeVisible());
    expect(screen.getByText('ยังไม่มีไฟล์ในพื้นที่ทำงาน')).toBeVisible();
  });
});
