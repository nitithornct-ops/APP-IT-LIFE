import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserRouter, MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { useTableParams, type TableParams } from './useTableParams';

afterEach(cleanup);

type Filters = 'status' | 'search';

let table: TableParams<Filters>;
let navigate: NavigateFunction;
let currentSearch = '';

function renderAt(initialEntry: string, defaultPageSize?: number) {
  function Probe() {
    table = useTableParams<Filters>({ filters: ['status', 'search'], defaultPageSize });
    navigate = useNavigate();
    currentSearch = useLocation().search;
    return (
      <span data-testid="state">
        {`${table.page}|${table.pageSize}|${table.sort?.key ?? '-'}|${table.sort?.order ?? '-'}|${table.filters.status}|${table.filters.search}`}
      </span>
    );
  }
  return render(<MemoryRouter initialEntries={[initialEntry]}><Probe /></MemoryRouter>);
}

const state = () => screen.getByTestId('state').textContent;
const param = (key: string) => new URLSearchParams(currentSearch).get(key);

describe('useTableParams', () => {
  it('อ่านค่าเริ่มต้นเมื่อ URL ยังว่าง', () => {
    renderAt('/tickets');
    expect(state()).toBe('1|10|-|-||');
  });

  it('อ่านหน้า ขนาดหน้า การเรียง และตัวกรองจาก URL — เปิดลิงก์ที่คนอื่นส่งมาแล้วได้หน้าเดียวกัน', () => {
    renderAt('/tickets?page=3&pageSize=25&sort=due_at&order=desc&status=กำลังดำเนินการ&search=TCK-1');
    expect(state()).toBe('3|25|due_at|desc|กำลังดำเนินการ|TCK-1');
  });

  it('มองข้ามค่า page/pageSize ที่ใช้ไม่ได้ แทนการพังทั้งหน้า', () => {
    renderAt('/tickets?page=0&pageSize=abc');
    expect(state()).toBe('1|10|-|-||');
  });

  it('ตั้ง order เป็น asc เมื่อ URL มี sort แต่ไม่มี order', () => {
    renderAt('/tickets?sort=title');
    expect(state()).toBe('1|10|title|asc||');
  });

  it('เขียนตัวกรองลง URL และไม่ใส่ค่าที่เท่ากับค่าเริ่มต้น', () => {
    renderAt('/tickets');

    act(() => table.setFilter('status', 'ปิดงานแล้ว'));
    expect(param('status')).toBe('ปิดงานแล้ว');

    act(() => table.setPage(1));
    expect(param('page')).toBeNull();

    act(() => table.setPageSize(10));
    expect(param('pageSize')).toBeNull();
  });

  it('ลบ filter ออกจาก URL เมื่อถูกตั้งเป็นค่าว่าง', () => {
    renderAt('/tickets?status=เปิดงาน');
    act(() => table.setFilter('status', ''));
    expect(currentSearch).toBe('');
  });

  it('กลับไปหน้า 1 ทุกครั้งที่เปลี่ยนตัวกรอง การเรียง หรือขนาดหน้า', () => {
    renderAt('/tickets?page=5');

    act(() => table.setFilter('status', 'เปิดงาน'));
    expect(table.page).toBe(1);

    act(() => table.setPage(4));
    expect(table.page).toBe(4);
    act(() => table.setSort({ key: 'due_at', order: 'asc' }));
    expect(table.page).toBe(1);

    act(() => table.setPage(4));
    act(() => table.setPageSize(50));
    expect(table.page).toBe(1);
  });

  it('setSort(null) ล้างทั้ง sort และ order', () => {
    renderAt('/tickets?sort=due_at&order=desc');
    act(() => table.setSort(null));
    expect(currentSearch).toBe('');
    expect(table.sort).toBeNull();
  });

  it('setFilters เปลี่ยนหลายตัวพร้อมกันในการอัปเดตครั้งเดียว', () => {
    renderAt('/tickets?page=2');
    act(() => table.setFilters({ status: 'เปิดงาน', search: 'abc' }));
    expect(table.filters).toEqual({ status: 'เปิดงาน', search: 'abc' });
    expect(table.page).toBe(1);
  });

  it('reset ล้างค่าของตาราง แต่ไม่แตะ query param อื่นของหน้า', () => {
    renderAt('/tickets?tab=login&page=3&sort=due_at&order=desc&status=เปิดงาน&search=abc');
    act(() => table.reset());
    expect(currentSearch).toBe('?tab=login');
  });

  it('รองรับหน้าที่ขนาดหน้าเริ่มต้นไม่ใช่ 10', () => {
    renderAt('/tickets', 20);
    expect(table.pageSize).toBe(20);

    act(() => table.setPageSize(20));
    expect(param('pageSize')).toBeNull();

    act(() => table.setPageSize(10));
    expect(param('pageSize')).toBe('10');
  });

  it('เปลี่ยนตัวกรองแล้วการเรียงต้องไม่หาย — ทั้งสองอยู่ใน URL เดียวกัน', () => {
    renderAt('/tickets');

    act(() => table.setSort({ key: 'due_at', order: 'asc' }));
    expect(param('sort')).toBe('due_at');

    act(() => table.setFilter('status', 'วิกฤต'));
    expect(param('status')).toBe('วิกฤต');
    expect(param('sort')).toBe('due_at');
    expect(param('order')).toBe('asc');
  });

  it('ปุ่ม Back ย้อนการกรองกลับไปสถานะก่อนหน้าได้', () => {
    renderAt('/tickets');

    act(() => table.setFilter('status', 'เปิดงาน'));
    act(() => table.setFilter('status', 'ปิดงานแล้ว'));
    expect(table.filters.status).toBe('ปิดงานแล้ว');

    act(() => navigate(-1));
    expect(table.filters.status).toBe('เปิดงาน');

    act(() => navigate(-1));
    expect(table.filters.status).toBe('');
  });

  it('โหมด replace ไม่ทิ้งรอยใน history ให้ต้องกด Back ทีละตัวอักษร', () => {
    renderAt('/tickets');

    act(() => table.setFilter('status', 'เปิดงาน'));
    act(() => table.setFilter('search', 'a', { replace: true }));
    act(() => table.setFilter('search', 'ab', { replace: true }));
    act(() => table.setFilter('search', 'abc', { replace: true }));
    expect(table.filters.search).toBe('abc');

    // ถอยครั้งเดียวต้องข้ามการพิมพ์ทั้งหมดกลับไปตอนที่เพิ่งกรอง status
    act(() => navigate(-1));
    expect(table.filters.search).toBe('');
    expect(table.filters.status).toBe('');
  });
});

describe('useTableParams เมื่อ URL ของเบราว์เซอร์นำหน้า state ของ React', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('ต่อยอดจาก URL จริง ไม่ใช่ค่าที่ React commit ไว้ — ค่าที่เพิ่งตั้งไปจึงไม่หาย', () => {
    window.history.replaceState({}, '', '/tickets');

    function Probe() {
      table = useTableParams<Filters>({ filters: ['status', 'search'] });
      return null;
    }
    render(<BrowserRouter><Probe /></BrowserRouter>);

    // pushState ตรง ๆ เลียนแบบจังหวะที่ router เปลี่ยน URL แล้วแต่ React ยัง render ไม่เสร็จ
    // (router ฟังแค่ popstate จึงไม่รู้เรื่องการเปลี่ยนครั้งนี้ เหมือน render ที่ยังไม่ commit)
    act(() => window.history.pushState({}, '', '/tickets?sort=due_at&order=asc'));

    act(() => table.setFilter('status', 'วิกฤต'));

    const params = new URLSearchParams(window.location.search);
    expect(params.get('status')).toBe('วิกฤต');
    expect(params.get('sort')).toBe('due_at');
    expect(params.get('order')).toBe('asc');
  });
});
