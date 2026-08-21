import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportAllButton } from './ExportAllButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderButton(url = '/api/v1/tickets/export?status=%E0%B9%83%E0%B8%AB%E0%B8%A1%E0%B9%88') {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExportAllButton url={url} />
    </QueryClientProvider>,
  );
}

function captureDownload() {
  const written: string[] = [];
  const names: string[] = [];
  class RecordingBlob {
    constructor(parts: string[]) { written.push(parts.join('')); }
  }
  vi.stubGlobal('Blob', RecordingBlob);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    names.push(this.download);
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:export') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  return { written, names };
}

describe('ExportAllButton', () => {
  it('ดาวน์โหลดไฟล์ที่ server ประกอบมา พร้อม BOM ให้ Excel อ่านภาษาไทยออก', async () => {
    const { written, names } = captureDownload();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { filename: 'tickets-2026-08-21.csv', csv: '"เลขที่"\r\n"TCK-1"', rowCount: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /ส่งออกทั้งหมด/ }));

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toBe('﻿"เลขที่"\r\n"TCK-1"');
    expect(names[0]).toBe('tickets-2026-08-21.csv');
  });

  it('ส่งตัวกรองปัจจุบันไปด้วย ไฟล์ที่ได้จึงตรงกับที่เห็นบนหน้าจอ', async () => {
    captureDownload();
    const fetchMock = vi.fn(async (_input?: unknown) => new Response(
      JSON.stringify({ success: true, data: { filename: 'a.csv', csv: '"a"', rowCount: 0 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    renderButton('/api/v1/assets/export?status=%E0%B8%8B%E0%B9%88%E0%B8%AD%E0%B8%A1%E0%B8%9A%E0%B8%B3%E0%B8%A3%E0%B8%B8%E0%B8%87');
    fireEvent.click(screen.getByRole('button', { name: /ส่งออกทั้งหมด/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/assets/export?status=');
  });

  it('บอกจำนวนจริงเมื่อเกินเพดาน แทนที่จะเงียบหรือส่งไฟล์ที่ขาดหาย', async () => {
    captureDownload();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: false, error: { code: 'EXPORT_TOO_LARGE', message: 'ข้อมูลที่ตรงกับตัวกรองมี 8,412 รายการ เกินเพดาน 5,000 รายการต่อไฟล์' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )));

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /ส่งออกทั้งหมด/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('8,412 รายการ');
  });
});
