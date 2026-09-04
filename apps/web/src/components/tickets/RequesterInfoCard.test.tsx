import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RequesterInfoCard } from './RequesterInfoCard';

afterEach(cleanup);

describe('RequesterInfoCard', () => {
  it('แสดงเฉพาะช่องที่ผู้แจ้งกรอกไว้จริง', () => {
    render(<RequesterInfoCard info={{ name: 'สมชาย ใจดี', position: '   ', phone: '0812345678', department: null }} />);

    expect(screen.getByText('ชื่อผู้แจ้ง')).toBeVisible();
    expect(screen.getByText('สมชาย ใจดี')).toBeVisible();
    expect(screen.getByText('เบอร์ติดต่อ')).toBeVisible();
    // ช่องว่างล้วนกับ null ต้องไม่กลายเป็นแถวเปล่า
    expect(screen.queryByText('ตำแหน่ง')).not.toBeInTheDocument();
    expect(screen.queryByText('ส่วนงาน')).not.toBeInTheDocument();
  });

  it('จัดรูปแบบวันที่พบปัญหาเป็นวันที่ไทย', () => {
    render(<RequesterInfoCard info={{ name: 'สมชาย ใจดี', incidentAt: '2026-08-19T02:30:00.000Z' }} />);

    expect(screen.getByText('วันที่พบปัญหา')).toBeVisible();
    expect(screen.getByText(/2569/)).toBeVisible();
  });

  it('ไม่ขึ้นการ์ดเปล่าเมื่อไม่มีข้อมูลผู้แจ้งเลย', () => {
    render(<RequesterInfoCard info={{ name: null, phone: undefined }} />);

    expect(screen.queryByTestId('requester-info')).not.toBeInTheDocument();
  });
});
