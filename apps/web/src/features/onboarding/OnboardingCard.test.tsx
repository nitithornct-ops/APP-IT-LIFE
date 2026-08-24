import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeProfile, MeResponse } from '../../stores/authContext';
import { OnboardingCard } from './OnboardingCard';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  refetchMe: vi.fn(),
  me: undefined as MeResponse | undefined,
  permissions: [] as string[],
}));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: mocks.apiFetch };
});
vi.mock('../../stores/authContext', () => ({
  useAuth: () => ({
    me: mocks.me,
    hasPermission: (permission: string) => mocks.permissions.includes(permission),
    refetchMe: mocks.refetchMe,
  }),
}));

function makeMe(profile: Partial<MeProfile> = {}): MeResponse {
  return {
    profile: {
      id: 'user-1',
      employee_code: 'EMP-001',
      full_name: 'สมชาย ใจดี',
      email: 'somchai@life.local',
      phone: null,
      department_id: null,
      position_id: null,
      supervisor_id: null,
      status: 'active',
      onboarding_completed_at: null,
      onboarding_dismissed_at: null,
      ...profile,
    },
    roles: [],
    permissions: [],
  };
}

beforeEach(() => {
  mocks.me = makeMe();
  mocks.permissions = ['dashboard.view', 'ticket.create'];
  mocks.apiFetch.mockResolvedValue({ onboarding_completed_at: '2026-08-23T10:00:00.000Z', onboarding_dismissed_at: null });
});

afterEach(() => {
  cleanup();
  mocks.apiFetch.mockReset();
  mocks.refetchMe.mockReset();
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OnboardingCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingCard', () => {
  it('greets a brand new account and offers a way out', () => {
    renderCard();
    expect(screen.getByText('ยินดีต้อนรับ สมชาย')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ข้ามไปใช้ค่าเริ่มต้น' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ไม่ต้องแสดงอีก/ })).toBeInTheDocument();
  });

  it('stays hidden once the account already closed it', () => {
    mocks.me = makeMe({ onboarding_dismissed_at: '2026-08-01T00:00:00.000Z' });
    renderCard();
    expect(screen.queryByText(/ยินดีต้อนรับ/)).not.toBeInTheDocument();

    cleanup();
    mocks.me = makeMe({ onboarding_completed_at: '2026-08-01T00:00:00.000Z' });
    renderCard();
    expect(screen.queryByText(/ยินดีต้อนรับ/)).not.toBeInTheDocument();
  });

  it('ticks only the step the system can actually verify', () => {
    mocks.me = makeMe({ phone: '0800000001' });
    renderCard();
    // เบอร์โทรกรอกแล้ว = ตรวจได้จริง ส่วนอีกสองขั้นเป็นทางลัด ไม่ติ๊กถูกให้
    expect(screen.getByText('ทำแล้ว')).toBeInTheDocument();
    expect(screen.getAllByText('ทำแล้ว')).toHaveLength(1);
  });

  it('does not tick the profile step while the phone is still blank', () => {
    renderCard();
    expect(screen.queryByText('ทำแล้ว')).not.toBeInTheDocument();
  });

  it('only shows steps the account has permission to reach', () => {
    mocks.permissions = [];
    renderCard();
    expect(screen.getByText('เติมเบอร์โทรในโปรไฟล์')).toBeInTheDocument();
    expect(screen.queryByText('ดูคิวงานของฉัน')).not.toBeInTheDocument();
    expect(screen.queryByText('ลองเปิดใบแจ้งซ่อม')).not.toBeInTheDocument();
  });

  it('records skipping separately from finishing', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'ข้ามไปใช้ค่าเริ่มต้น' }));
    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/auth/onboarding', {
        method: 'POST',
        body: JSON.stringify({ dismissed: true }),
      }),
    );

    cleanup();
    mocks.apiFetch.mockClear();
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /ไม่ต้องแสดงอีก/ }));
    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/auth/onboarding', {
        method: 'POST',
        body: JSON.stringify({ dismissed: false }),
      }),
    );
  });

  it('keeps the card up and says so when saving the state fails', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('เครือข่ายขัดข้อง'));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'ข้ามไปใช้ค่าเริ่มต้น' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ปิดคำแนะนำไม่สำเร็จ'));
    expect(screen.getByText('ยินดีต้อนรับ สมชาย')).toBeInTheDocument();
  });
});
