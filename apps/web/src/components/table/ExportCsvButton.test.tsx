import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportCsvButton } from './ExportCsvButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    const written = captureDownload();

    render(
      <ExportCsvButton
        fileName="assets-page-1.csv"
        getRows={() => [['รหัส', 'ชื่อ'], ['A-001', '=HYPERLINK("https://unsafe.test")']]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ส่งออกหน้านี้' }));
    vi.unstubAllGlobals();

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('"รหัส","ชื่อ"');
    expect(written[0]).toContain(`"'=HYPERLINK(""https://unsafe.test"")"`);
  });

  it('ไม่เรียก getRows จนกว่าจะกดปุ่ม', () => {
    const getRows = vi.fn(() => [['หัวข้อ']]);
    render(<ExportCsvButton fileName="x.csv" getRows={getRows} />);
    expect(getRows).not.toHaveBeenCalled();
  });

  it('ปิดปุ่มเมื่อไม่มีข้อมูลให้ส่งออก', () => {
    render(<ExportCsvButton fileName="x.csv" disabled getRows={() => [['หัวข้อ']]} />);
    expect(screen.getByRole('button', { name: 'ส่งออกหน้านี้' })).toBeDisabled();
  });
});
