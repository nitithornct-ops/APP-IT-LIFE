import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportCsvButton } from './ExportCsvButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * ปุ่มถามสถานะ Google Drive ผ่าน react-query — เทสต์จึงต้องมี provider และคำตอบของ /status เสมอ
 * ค่าเริ่มต้นคือ "ยังไม่ได้ตั้งค่า" ซึ่งตรงกับสภาพแวดล้อมที่ยังไม่ได้เปิดฟีเจอร์นี้
 */
function renderButton(ui: ReactElement, { driveEnabled = false } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    // ปุ่มขึ้นเมื่อปลายทางถูกตั้งค่าไว้ "และ" ผู้ใช้มีสิทธิ์ report.export — เทสต์ชุดนี้จำลองผู้ใช้ที่มีสิทธิ์
    if (url.includes('/api/v1/google-drive/status')) return envelope({ enabled: driveEnabled, canExport: driveEnabled });
    if (url.includes('/api/v1/google-drive/sheets')) {
      return envelope({ id: 'sheet-1', name: 'assets-page-1', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-1/edit' });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return fetchMock;
}

function captureDownload() {
  const written: string[] = [];
  class RecordingBlob {
    constructor(parts: string[]) { written.push(parts.join('')); }
  }
  vi.stubGlobal('Blob', RecordingBlob);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:export') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  return written;
}

describe('ExportCsvButton', () => {
  it('สร้าง CSV จากแถวที่หน้าให้มา และ escape สูตรทุกเซลล์', () => {
    renderButton(
      <ExportCsvButton
        fileName="assets-page-1.csv"
        getRows={() => [['รหัส', 'ชื่อ'], ['A-001', '=HYPERLINK("https://unsafe.test")']]}
      />,
    );
    const written = captureDownload();

    fireEvent.click(screen.getByRole('button', { name: 'ส่งออกหน้านี้' }));
    vi.unstubAllGlobals();

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('"รหัส","ชื่อ"');
    expect(written[0]).toContain(`"'=HYPERLINK(""https://unsafe.test"")"`);
  });

  it('ไม่เรียก getRows จนกว่าจะกดปุ่ม', () => {
    const getRows = vi.fn(() => [['หัวข้อ']]);
    renderButton(<ExportCsvButton fileName="x.csv" getRows={getRows} />);
    expect(getRows).not.toHaveBeenCalled();
  });

  it('ปิดปุ่มเมื่อไม่มีข้อมูลให้ส่งออก', () => {
    renderButton(<ExportCsvButton fileName="x.csv" disabled getRows={() => [['หัวข้อ']]} />);
    expect(screen.getByRole('button', { name: 'ส่งออกหน้านี้' })).toBeDisabled();
  });

  it('ไม่แสดงปุ่ม Google Sheets เมื่อยังไม่ได้ตั้งค่าปลายทาง Drive', async () => {
    renderButton(<ExportCsvButton fileName="x.csv" getRows={() => [['หัวข้อ']]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ส่งออกหน้านี้' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'ส่งไป Google Sheets' })).not.toBeInTheDocument();
  });

  it('ส่ง CSV ก้อนเดียวกับไฟล์ที่ดาวน์โหลดขึ้นไปเป็น Google Sheets', async () => {
    const fetchMock = renderButton(
      <ExportCsvButton
        fileName="assets-page-1.csv"
        getRows={() => [['รหัส', 'ชื่อ'], ['A-001', '=HYPERLINK("https://unsafe.test")']]}
      />,
      { driveEnabled: true },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'ส่งไป Google Sheets' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/v1/google-drive/sheets'));
      expect(call).toBeDefined();
      const body = JSON.parse(call![1]!.body as string) as { filename: string; csv: string };
      expect(body.filename).toBe('assets-page-1.csv');
      expect(body.csv).toContain('"รหัส","ชื่อ"');
      // สูตรถูก escape เหมือนไฟล์ที่ดาวน์โหลด — ชีตที่ได้จึงไม่กลายเป็นช่องรันสูตรแทน
      expect(body.csv).toContain(`"'=HYPERLINK(""https://unsafe.test"")"`);
    });

    expect(await screen.findByRole('link', { name: /เปิดใน Google Sheets/ })).toHaveAttribute(
      'href',
      'https://docs.google.com/spreadsheets/d/sheet-1/edit',
    );
  });
});
