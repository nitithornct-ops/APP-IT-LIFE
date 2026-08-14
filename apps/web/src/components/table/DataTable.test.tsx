import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DataTable', () => {
  it('uses the global 10-row pagination and changes only table rows', () => {
    render(
      <DataTable>
        <thead><tr><th>รายการ</th></tr></thead>
        <tbody>{Array.from({ length: 12 }, (_, index) => <tr key={index}><td>แถว {index + 1}</td></tr>)}</tbody>
      </DataTable>,
    );

    expect(screen.getByText('แถว 1')).toBeVisible();
    expect(screen.queryByText('แถว 11')).not.toBeInTheDocument();
    expect(screen.getByText('รายการ 1–10 จาก 12')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'หน้าถัดไป' }));
    expect(screen.getByText('แถว 11')).toBeVisible();
    expect(screen.queryByText('แถว 1')).not.toBeInTheDocument();
    expect(screen.getByText('หน้า 2 / 2')).toBeVisible();
  });

  it('supports the standard page-size choices', () => {
    render(
      <DataTable>
        <tbody>{Array.from({ length: 30 }, (_, index) => <tr key={index}><td>รายการ {index + 1}</td></tr>)}</tbody>
      </DataTable>,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'จำนวนรายการต่อหน้า' }), { target: { value: '25' } });
    expect(screen.getByText('รายการ 1–25 จาก 30')).toBeVisible();
    expect(screen.getByText('รายการ 25')).toBeVisible();
    expect(screen.queryByText('รายการ 26')).not.toBeInTheDocument();
  });

  it('searches rows and filters a selected column', () => {
    render(
      <DataTable>
        <thead><tr><th>ชื่อ</th><th>สถานะ</th></tr></thead>
        <tbody>
          <tr><td>Printer A</td><td>ใช้งาน</td></tr>
          <tr><td>Notebook B</td><td>ซ่อมบำรุง</td></tr>
          <tr><td>Notebook C</td><td>ใช้งาน</td></tr>
        </tbody>
      </DataTable>,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหาในตาราง' }), { target: { value: 'Notebook' } });
    expect(screen.queryByText('Printer A')).not.toBeInTheDocument();
    expect(screen.getByText('Notebook B')).toBeVisible();

    fireEvent.change(screen.getByRole('combobox', { name: 'เลือกคอลัมน์สำหรับกรอง' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'ค่าที่ต้องการกรองใน สถานะ' }), { target: { value: 'ใช้งาน' } });
    expect(screen.queryByText('Notebook B')).not.toBeInTheDocument();
    expect(screen.getByText('Notebook C')).toBeVisible();
  });

  it('allows columns to be hidden while keeping at least one visible', () => {
    render(
      <DataTable>
        <thead><tr><th>ชื่อ</th><th>สถานะ</th></tr></thead>
        <tbody><tr><td>Printer A</td><td>ใช้งาน</td></tr></tbody>
      </DataTable>,
    );

    fireEvent.click(screen.getByRole('button', { name: /คอลัมน์/ }));
    fireEvent.click(screen.getByRole('button', { name: 'สถานะ' }));
    expect(screen.getByText('ใช้งาน')).not.toBeVisible();
    expect(screen.getByText('Printer A')).toBeVisible();
  });

  it('exports the filtered visible rows as CSV', () => {
    const createObjectURL = vi.fn(() => 'blob:table-export');
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    render(
      <DataTable exportFileName="assets.csv">
        <thead><tr><th>ชื่อ</th><th>สถานะ</th></tr></thead>
        <tbody>
          <tr><td>Printer A</td><td>ใช้งาน</td></tr>
          <tr><td>Notebook B</td><td>ซ่อมบำรุง</td></tr>
        </tbody>
      </DataTable>,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหาในตาราง' }), { target: { value: 'Printer' } });
    fireEvent.click(screen.getByRole('button', { name: 'ส่งออก CSV' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:table-export');
    click.mockRestore();
  });
});
