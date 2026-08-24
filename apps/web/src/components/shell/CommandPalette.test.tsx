import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';

const navigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../hooks/useNavItems', () => ({
  useNavItems: () => [
    {
      label: 'หลัก',
      items: [
        { label: 'ใบงาน', path: '/tickets', icon: () => null },
        { label: 'CMDB', path: '/cmdb', icon: () => null },
      ],
    },
  ],
}));

afterEach(() => {
  cleanup();
  navigate.mockReset();
  vi.unstubAllGlobals();
});

function searchResponse() {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        groups: [
          {
            module: 'ticket',
            label: 'ใบงาน',
            items: [{ id: 't-1', title: 'TCK-1042 · เครื่องพิมพ์เสีย', subtitle: 'กำลังดำเนินการ', path: '/tickets/t-1' }],
          },
        ],
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function cmdbResponse() {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        items: [
          {
            id: 'ci-1',
            ci_code: 'CI-APP-001',
            name: 'LIFE Portal',
            ci_type: 'Application',
            environment: 'Production',
            status: 'Active',
          },
        ],
        pagination: { page: 1, pageSize: 5, totalItems: 1, totalPages: 1 },
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette open onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CommandPalette', () => {
  it('ค้นได้ถึงตัวข้อมูลจริง ไม่ใช่แค่ชื่อเมนู', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => searchResponse()));
    renderPalette();

    fireEvent.change(screen.getByLabelText('คำค้นหา'), { target: { value: 'TCK-1042' } });

    expect(await screen.findByText('TCK-1042 · เครื่องพิมพ์เสีย')).toBeTruthy();
    expect(screen.getByText('กำลังดำเนินการ')).toBeTruthy();
  });

  it('ค้น CI ผ่าน endpoint เดิมของ CMDB และเปิดหน้ารายละเอียดได้', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => (
      String(input).includes('/api/v1/cmdb/items') ? cmdbResponse() : searchResponse()
    )));
    renderPalette();

    const input = screen.getByLabelText('คำค้นหา');
    fireEvent.change(input, { target: { value: 'CI-APP-001' } });
    fireEvent.click(await screen.findByRole('button', { name: /CI-APP-001 · LIFE Portal/ }));

    expect(navigate).toHaveBeenCalledWith('/cmdb/ci-1');
  });

  it('ไม่ยิงคำค้นที่สั้นกว่าเพดานของ api ออกไปให้ถูกปฏิเสธเปล่า ๆ', async () => {
    const fetchMock = vi.fn(async () => searchResponse());
    vi.stubGlobal('fetch', fetchMock);
    renderPalette();

    fireEvent.change(screen.getByLabelText('คำค้นหา'), { target: { value: 'T' } });

    await waitFor(() => expect(screen.getByText(/พิมพ์อย่างน้อย 2 ตัวอักษร/)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ปุ่มลูกศรเลื่อนข้ามจากกลุ่มเมนูไปกลุ่มข้อมูลได้เป็นเส้นเดียว', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => searchResponse()));
    renderPalette();

    const input = screen.getByLabelText('คำค้นหา');
    fireEvent.change(input, { target: { value: 'ใบงาน' } });
    await screen.findByText('TCK-1042 · เครื่องพิมพ์เสีย');

    // แถวแรกคือเมนู กดลงหนึ่งครั้งต้องข้ามไปแถวแรกของกลุ่มข้อมูล
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(navigate).toHaveBeenCalledWith('/tickets/t-1');
  });

  it('เมนูอยู่ก่อนผลจากฐานข้อมูลเสมอ รายการที่เล็งไว้จะได้ไม่ขยับหนีตอนผลค้นหามาถึง', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => searchResponse()));
    renderPalette();

    const input = screen.getByLabelText('คำค้นหา');
    fireEvent.change(input, { target: { value: 'ใบงาน' } });
    await screen.findByText('TCK-1042 · เครื่องพิมพ์เสีย');

    const headings = screen.getAllByText(/^(เมนู|ใบงาน)$/).map((node) => node.textContent);
    expect(headings[0]).toBe('เมนู');
  });
});
