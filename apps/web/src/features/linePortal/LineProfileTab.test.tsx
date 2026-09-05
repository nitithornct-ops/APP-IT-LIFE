import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineProfileTab } from './LineProfileTab';
import type { LinePortalProfile } from './types';

vi.mock('../../services/lineApiClient', () => ({ lineApiFetch: vi.fn() }));

const profile = (overrides: Partial<LinePortalProfile> = {}): LinePortalProfile => ({
  displayName: 'Nitithorn',
  pictureUrl: '',
  fullName: 'นิธิธร ชูเกียรติ',
  department: 'ฝ่ายบัญชีและการเงิน',
  linkStatus: 'Active',
  friendStatus: 'Friend',
  linkedToSystemAccount: true,
  employeeCode: 'EMP-0031',
  ...overrides,
});

afterEach(cleanup);

function renderTab(overrides: Partial<LinePortalProfile> = {}) {
  render(<LineProfileTab profile={profile(overrides)} onProfileSaved={vi.fn()} onLogout={vi.fn()} />);
}

describe('LineProfileTab', () => {
  it('shows the linked employee account, not just that the LINE account works', () => {
    renderTab();

    expect(screen.getByText('เชื่อมกับบัญชีผู้ใช้ในระบบ')).toBeVisible();
    expect(screen.getByText('เชื่อมแล้ว · EMP-0031')).toBeVisible();
    expect(screen.queryByText(/โปรไฟล์ของฉัน/)).not.toBeInTheDocument();
  });

  // ป้ายเดิมเขียนว่า "เชื่อมบัญชีแล้ว" ทั้งที่ยังไม่ได้ผูกกับบัญชีผู้ใช้ ทำให้คนเข้าใจว่าจะได้รับแจ้งเตือนครบ
  it('separates an active LINE account from a linked system account', () => {
    renderTab({ linkedToSystemAccount: false, employeeCode: null });

    expect(screen.getByText('สถานะบัญชี LINE')).toBeVisible();
    expect(screen.getByText('ใช้งานได้')).toBeVisible();
    expect(screen.getByText('ยังไม่เชื่อม')).toBeVisible();
  });

  it('tells an unlinked user what they are missing and where to link it themselves', () => {
    renderTab({ linkedToSystemAccount: false, employeeCode: null });

    expect(screen.getByText(/โปรไฟล์ของฉัน/)).toBeVisible();
    expect(screen.getByText(/การเตือน SLA/)).toBeVisible();
  });
});
