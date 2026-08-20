import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
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

  it('ส่งออกเซลล์ที่ขึ้นต้นด้วยสูตรเป็นข้อความ ไม่ให้ Excel รันเป็นสูตร', () => {
    const written: string[] = [];
    class RecordingBlob {
      constructor(parts: string[]) { written.push(parts.join('')); }
    }
    vi.stubGlobal('Blob', RecordingBlob);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:table-export') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

    render(
      <DataTable exportFileName="assets.csv">
        <thead><tr><th>ชื่อ</th><th>หมายเหตุ</th></tr></thead>
        <tbody><tr><td>=cmd|' /C calc'!A0</td><td>ปกติ</td></tr></tbody>
      </DataTable>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ส่งออก CSV' }));
    vi.unstubAllGlobals();

    expect(written).toHaveLength(1);
    expect(written[0]).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(written[0]).not.toContain(`,"=cmd`);
  });

  it('mode="server" ไม่ render ช่องค้นหา ตัวกรอง ส่งออก และการแบ่งหน้าในตัว', () => {
    render(
      <DataTable mode="server">
        <thead><tr><th>ชื่อ</th></tr></thead>
        <tbody>{Array.from({ length: 12 }, (_, index) => <tr key={index}><td>แถว {index + 1}</td></tr>)}</tbody>
      </DataTable>,
    );

    expect(screen.queryByRole('searchbox', { name: 'ค้นหาในตาราง' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'เลือกคอลัมน์สำหรับกรอง' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ส่งออก CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /คอลัมน์/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'การแบ่งหน้าตาราง' })).not.toBeInTheDocument();
  });

  it('mode="server" แสดงทุกแถวที่หน้าส่งมาโดยไม่ตัดหน้าเอง', () => {
    render(
      <DataTable mode="server">
        <thead><tr><th>ชื่อ</th></tr></thead>
        <tbody>{Array.from({ length: 12 }, (_, index) => <tr key={index}><td>แถว {index + 1}</td></tr>)}</tbody>
      </DataTable>,
    );

    expect(screen.getByText('แถว 1')).toBeVisible();
    expect(screen.getByText('แถว 12')).toBeVisible();
  });
  it('เรียงขึ้น/ลง/กลับค่าเดิม เมื่อกดหัวคอลัมน์ที่มี data-sort-key', () => {
    render(
      <DataTable pagination={false} toolbar={false}>
        <thead><tr><th data-sort-key="name">ชื่อ</th></tr></thead>
        <tbody>
          <tr><td>บี</td></tr>
          <tr><td>เอ</td></tr>
          <tr><td>ซี</td></tr>
        </tbody>
      </DataTable>,
    );

    const header = screen.getByRole('button', { name: 'ชื่อ' });
    const names = () => screen.getAllByRole('cell').map((cell) => cell.textContent);

    expect(names()).toEqual(['บี', 'เอ', 'ซี']);

    fireEvent.click(header);
    expect(names()).toEqual(['ซี', 'บี', 'เอ']);

    fireEvent.click(header);
    expect(names()).toEqual(['เอ', 'บี', 'ซี']);

    fireEvent.click(header);
    expect(names()).toEqual(['บี', 'เอ', 'ซี']);
  });

  it('ประกาศ aria-sort ตามทิศทางที่เรียงอยู่', () => {
    render(
      <DataTable pagination={false} toolbar={false}>
        <thead><tr><th data-sort-key="name">ชื่อ</th><th>สถานะ</th></tr></thead>
        <tbody><tr><td>เอ</td><td>ใช้งาน</td></tr></tbody>
      </DataTable>,
    );

    const sortable = screen.getByRole('columnheader', { name: /ชื่อ/ });
    expect(sortable).toHaveAttribute('aria-sort', 'none');
    // คอลัมน์ที่ไม่ได้ประกาศ data-sort-key ต้องไม่กลายเป็นปุ่ม
    expect(screen.getByRole('columnheader', { name: 'สถานะ' })).not.toHaveAttribute('aria-sort');
    expect(screen.queryByRole('button', { name: 'สถานะ' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ชื่อ' }));
    expect(sortable).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'ชื่อ' }));
    expect(sortable).toHaveAttribute('aria-sort', 'descending');
  });

  it('ใช้ data-sort-value แทนข้อความที่แสดง เพื่อให้วันที่และตัวเลขเรียงถูก', () => {
    render(
      <DataTable pagination={false} toolbar={false}>
        <thead><tr><th data-sort-key="due">ครบกำหนด</th></tr></thead>
        <tbody>
          <tr><td data-sort-value="2026-03-01">1 มี.ค. 2569</td></tr>
          <tr><td data-sort-value="2026-01-15">15 ม.ค. 2569</td></tr>
          <tr><td data-sort-value="2026-02-20">20 ก.พ. 2569</td></tr>
        </tbody>
      </DataTable>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ครบกำหนด' }));
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['15 ม.ค. 2569', '20 ก.พ. 2569', '1 มี.ค. 2569']);
  });

  it('ดันแถวที่ไม่มีค่าไปท้ายเสมอ ไม่ว่าจะเรียงขึ้นหรือลง', () => {
    render(
      <DataTable pagination={false} toolbar={false}>
        <thead><tr><th data-sort-key="score">คะแนน</th></tr></thead>
        <tbody>
          <tr><td>3</td></tr>
          <tr><td /></tr>
          <tr><td>1</td></tr>
        </tbody>
      </DataTable>,
    );

    const header = screen.getByRole('button', { name: 'คะแนน' });
    const scores = () => screen.getAllByRole('cell').map((cell) => cell.textContent);

    fireEvent.click(header);
    expect(scores()).toEqual(['1', '3', '']);
    fireEvent.click(header);
    expect(scores()).toEqual(['3', '1', '']);
  });

  it('mode="server" ไม่เรียงเอง แต่แจ้ง onSortChange ให้หน้าไปยิง API', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable mode="server" sort={null} onSortChange={onSortChange}>
        <thead><tr><th data-sort-key="due_at">ครบกำหนด SLA</th></tr></thead>
        <tbody>
          <tr><td>บี</td></tr>
          <tr><td>เอ</td></tr>
        </tbody>
      </DataTable>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ครบกำหนด SLA' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'due_at', order: 'asc' });
    // ลำดับแถวต้องไม่ถูกแตะ เพราะ API เป็นคนเรียง
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['บี', 'เอ']);
  });

  it('mode="server" หมุน asc → desc → ล้างค่า ตามสถานะที่หน้าส่งมา', () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <DataTable mode="server" sort={{ key: 'due_at', order: 'asc' }} onSortChange={onSortChange}>
        <thead><tr><th data-sort-key="due_at">ครบกำหนด SLA</th></tr></thead>
        <tbody><tr><td>เอ</td></tr></tbody>
      </DataTable>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ครบกำหนด SLA' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'due_at', order: 'desc' });

    rerender(
      <DataTable mode="server" sort={{ key: 'due_at', order: 'desc' }} onSortChange={onSortChange}>
        <thead><tr><th data-sort-key="due_at">ครบกำหนด SLA</th></tr></thead>
        <tbody><tr><td>เอ</td></tr></tbody>
      </DataTable>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ครบกำหนด SLA' }));
    expect(onSortChange).toHaveBeenLastCalledWith(null);
  });
  it('data-sort-label ตั้งชื่อปุ่มได้ เมื่อหัวคอลัมน์รวมหลายอย่าง', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable mode="server" sort={null} onSortChange={onSortChange}>
        <thead><tr><th data-sort-key="due_at" data-sort-label="เรียงตามวันครบกำหนด SLA">สถานะ/SLA</th></tr></thead>
        <tbody><tr><td>เอ</td></tr></tbody>
      </DataTable>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'เรียงตามวันครบกำหนด SLA' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'due_at', order: 'asc' });
  });
  it('จำคอลัมน์ที่ซ่อนและจำนวนแถวต่อหน้าไว้เมื่อมี tableId', () => {
    const markup = (
      <DataTable tableId="assets">
        <thead><tr><th>ชื่อ</th><th>สถานะ</th></tr></thead>
        <tbody>{Array.from({ length: 30 }, (_, index) => <tr key={index}><td>แถว {index + 1}</td><td>ใช้งาน</td></tr>)}</tbody>
      </DataTable>
    );

    const first = render(markup);
    fireEvent.click(screen.getByRole('button', { name: /คอลัมน์/ }));
    fireEvent.click(screen.getByRole('button', { name: 'สถานะ' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'จำนวนรายการต่อหน้า' }), { target: { value: '25' } });
    expect(screen.getAllByText('ใช้งาน')[0]).not.toBeVisible();
    first.unmount();

    render(markup);
    expect(screen.getAllByText('ใช้งาน')[0]).not.toBeVisible();
    expect(screen.getByRole('combobox', { name: 'จำนวนรายการต่อหน้า' })).toHaveValue('25');
  });

  it('ไม่จำอะไรเลยเมื่อไม่ได้ระบุ tableId', () => {
    const before = localStorage.length;
    render(
      <DataTable>
        <thead><tr><th>ชื่อ</th><th>สถานะ</th></tr></thead>
        <tbody><tr><td>แถว 1</td><td>ใช้งาน</td></tr></tbody>
      </DataTable>,
    );
    fireEvent.click(screen.getByRole('button', { name: /คอลัมน์/ }));
    fireEvent.click(screen.getByRole('button', { name: 'สถานะ' }));
    expect(localStorage.length).toBe(before);
  });

  it('ค่าที่เสียใน localStorage ไม่ทำให้ตารางพัง', () => {
    localStorage.setItem('itlife-table:broken', '{ not json');
    render(
      <DataTable tableId="broken">
        <thead><tr><th>ชื่อ</th></tr></thead>
        <tbody><tr><td>แถว 1</td></tr></tbody>
      </DataTable>,
    );
    expect(screen.getByText('แถว 1')).toBeVisible();
  });
});
