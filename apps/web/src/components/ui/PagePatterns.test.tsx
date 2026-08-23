import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorState, LoadingState } from './AsyncState';
import { Button } from './Button';
import { DetailLayout } from './DetailLayout';
import { FilterBar } from './FilterBar';
import { KpiStrip } from './KpiStrip';
import { PageHeader } from './PageHeader';
import { SlaBadge } from './SlaBadge';
import { StatusBadge } from './StatusBadge';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('shared page patterns', () => {
  it('PageHeader วางบริบท ชื่อ คำอธิบาย และ primary action ไว้ในหัวเดียวกัน', () => {
    render(
      <PageHeader
        eyebrow="Service Desk / Ticket"
        title="รายการ Ticket"
        description="ติดตามและตัดสินใจงานจากหน้าจอเดียว"
        meta={<span>42 รายการ</span>}
        secondaryActions={<Button variant="outline">รายงาน</Button>}
        primaryAction={<Button>เปิด Ticket</Button>}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'รายการ Ticket' })).toBeVisible();
    expect(screen.getByText('Service Desk / Ticket')).toBeVisible();
    expect(screen.getByText('42 รายการ')).toBeVisible();
    expect(screen.getByRole('button', { name: 'เปิด Ticket' })).toBeVisible();
  });

  it('KpiStrip รองรับทั้งลิงก์และตัวกรองแบบกดได้', () => {
    const onFilter = vi.fn();
    render(
      <MemoryRouter>
        <KpiStrip
          items={[
            { key: 'all', label: 'ทั้งหมด', value: 42, href: '/tickets' },
            { key: 'critical', label: 'วิกฤต', value: 3, onClick: onFilter, active: true },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'ทั้งหมด: 42' })).toHaveAttribute('href', '/tickets');
    const critical = screen.getByRole('button', { name: 'วิกฤต: 3' });
    expect(critical).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(critical);
    expect(onFilter).toHaveBeenCalledOnce();
  });

  it('FilterBar รวม search ตัวกรองด่วน จำนวนผล และล้างตัวกรองในครั้งเดียว', () => {
    const onSearchChange = vi.fn();
    const onQuickFilter = vi.fn();
    const onClear = vi.fn();
    render(
      <FilterBar
        searchValue="printer"
        onSearchChange={onSearchChange}
        onClear={onClear}
        activeFilterCount={2}
        resultCount={8}
        itemLabel="Ticket"
        quickFilters={[{ key: 'mine', label: 'ของฉัน', active: false, onClick: onQuickFilter }]}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหาในรายการ' }), { target: { value: 'network' } });
    fireEvent.click(screen.getByRole('button', { name: 'ของฉัน' }));
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง (2)' }));
    expect(onSearchChange).toHaveBeenCalledWith('network');
    expect(onQuickFilter).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('8 Ticket');
  });

  it('StatusBadge และ SlaBadge แสดงสถานะด้วยข้อความเสมอ', () => {
    const { rerender } = render(<StatusBadge display={{ label: 'กำลังดำเนินการ', tone: 'info' }} />);
    expect(screen.getByText('กำลังดำเนินการ')).toBeVisible();

    rerender(<SlaBadge display={{ state: 'overdue', tone: 'danger', label: 'เกิน SLA 2 ชม.' }} />);
    expect(screen.getByText('เกิน SLA 2 ชม.')).toBeVisible();

    rerender(<SlaBadge display={null} fallback="เหลือ 2 วัน" />);
    expect(screen.getByText('เหลือ 2 วัน')).toBeVisible();
  });

  it('LoadingState ไม่แสดงผลก่อนครบ 180ms', () => {
    vi.useFakeTimers();
    render(<LoadingState />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByRole('status', { name: 'กำลังโหลดข้อมูล...' })).toBeVisible();
  });

  it('ErrorState บอกทางลองใหม่ และ DetailLayout มีแผงควบคุมแยกชัดเจน', () => {
    const onRetry = vi.fn();
    render(
      <DetailLayout aside={<p>ผู้รับผิดชอบ</p>} timeline={<p>ไทม์ไลน์</p>}>
        <ErrorState onRetry={onRetry} />
      </DetailLayout>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('complementary', { name: 'แผงควบคุมและข้อมูลประกอบ' })).toHaveTextContent('ผู้รับผิดชอบ');
    expect(screen.getByText('ไทม์ไลน์')).toBeVisible();
  });
});
