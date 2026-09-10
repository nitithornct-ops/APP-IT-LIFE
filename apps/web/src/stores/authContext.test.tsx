import type { Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/apiClient';
import { AuthProvider, useAuth, type MeResponse } from './authContext';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  emit: null as null | ((event: string, session: Session | null) => void),
}));

vi.mock('../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/apiClient')>();
  return { ...original, apiFetch: mocks.apiFetch };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

/** auth-js สร้าง object ใหม่ทุกครั้งที่ parse session จาก storage แม้เนื้อในจะเหมือนเดิมเป๊ะ */
function makeSession(accessToken = 'token-1', userId = 'user-1'): Session {
  return {
    access_token: accessToken,
    refresh_token: 'refresh-1',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email: 'somchai@life.local' },
  } as unknown as Session;
}

const ME: MeResponse = {
  profile: {
    id: 'user-1',
    employee_code: 'EMP-001',
    full_name: 'สมชาย ใจดี',
    email: 'somchai@life.local',
    username: null,
    phone: null,
    department_id: null,
    position_id: null,
    supervisor_id: null,
    status: 'active',
  },
  roles: [],
  permissions: [],
};

let renderCount = 0;
let refreshMfa: () => Promise<void>;

function Probe() {
  renderCount += 1;
  const auth = useAuth();
  refreshMfa = auth.refreshMfa;
  return (
    <div>
      <span data-testid="mfa-loading">{String(auth.isMfaLoading)}</span>
      <span data-testid="mfa-required">{String(auth.mfaRequired)}</span>
      <span data-testid="me">{auth.me?.profile.full_name ?? '-'}</span>
      <span data-testid="token">{auth.session?.access_token ?? 'none'}</span>
    </div>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** จำนวนครั้งที่ยิงถามนโยบาย MFA — ตัวชี้วัดตรง ๆ ว่ามีการตรวจซ้ำโดยไม่จำเป็นหรือไม่ */
function policyCalls(): number {
  return mocks.apiFetch.mock.calls.filter((call) => call[0] === '/api/v1/auth/mfa-policy').length;
}

/** รอจนโหลดครั้งแรกจบสนิท (ทั้งนโยบาย MFA และ /auth/me) เพื่อให้จำนวน render นิ่ง */
async function waitForInitialLoad() {
  await waitFor(() => expect(screen.getByTestId('mfa-loading')).toHaveTextContent('false'));
  await waitFor(() => expect(screen.getByTestId('me')).toHaveTextContent('สมชาย ใจดี'));
}

beforeEach(() => {
  renderCount = 0;
  mocks.emit = null;
  mocks.getSession.mockResolvedValue({ data: { session: makeSession() } });
  mocks.onAuthStateChange.mockImplementation((callback: (event: string, session: Session | null) => void) => {
    mocks.emit = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  mocks.apiFetch.mockImplementation((path: string) => {
    if (path === '/api/v1/auth/mfa-policy') {
      return Promise.resolve({ required: false, reason: null, enrolled: false, currentLevel: 'aal1', needsEnrollment: false });
    }
    if (path === '/api/v1/auth/me') return Promise.resolve(ME);
    return Promise.reject(new Error('unexpected path ' + path));
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * auth-js ผูก visibilitychange ไว้เองและยิง SIGNED_IN ซ้ำทุกครั้งที่แท็บกลับมามองเห็น แม้ session ไม่เปลี่ยน
 * เดิม AuthProvider ตอบทุก event ด้วย setIsMfaLoading(true) ทำให้ <ProtectedRoute> คืนสปินเนอร์แทน
 * <AppShell /> — ทั้งแอปถูก unmount ทิ้งทุกครั้งที่สลับแอปกลับมา (ผู้ใช้แจ้ง 2026-09-09)
 */
describe('AuthProvider เมื่อแท็บกลับมามองเห็น', () => {
  it('ไม่ตรวจนโยบาย MFA ซ้ำ และไม่กลับไปสถานะกำลังโหลด เมื่อได้ SIGNED_IN ของผู้ใช้คนเดิม', async () => {
    renderProvider();
    await waitForInitialLoad();
    expect(policyCalls()).toBe(1);

    await act(async () => {
      mocks.emit?.('SIGNED_IN', makeSession());
    });

    expect(policyCalls()).toBe(1);
    expect(screen.getByTestId('mfa-loading')).toHaveTextContent('false');
  });

  it('ไม่ตรวจซ้ำเมื่อโทเคนถูกต่ออายุ แต่ยังเป็นผู้ใช้คนเดิม', async () => {
    renderProvider();
    await waitForInitialLoad();

    await act(async () => {
      mocks.emit?.('TOKEN_REFRESHED', makeSession('token-2'));
    });

    expect(policyCalls()).toBe(1);
    expect(screen.getByTestId('mfa-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('token')).toHaveTextContent('token-2');
  });

  it('ไม่ re-render ทั้งแอปเมื่อได้ session object ใบใหม่ที่เนื้อในเหมือนเดิม', async () => {
    renderProvider();
    await waitForInitialLoad();
    const settled = renderCount;

    await act(async () => {
      mocks.emit?.('SIGNED_IN', makeSession());
    });

    expect(renderCount).toBe(settled);
  });

  it('ตรวจนโยบาย MFA ใหม่เมื่อเปลี่ยนตัวผู้ใช้จริง', async () => {
    renderProvider();
    await waitForInitialLoad();

    await act(async () => {
      mocks.emit?.('SIGNED_IN', makeSession('token-9', 'user-2'));
    });

    await waitFor(() => expect(policyCalls()).toBe(2));
  });
});

describe('AuthProvider เมื่อขอนโยบาย MFA ไม่สำเร็จ', () => {
  it('กันไว้ก่อน (fail closed) ถ้ายังไม่เคยได้คำตอบจากเซิร์ฟเวอร์เลย', async () => {
    mocks.apiFetch.mockImplementation((path: string) => {
      if (path === '/api/v1/auth/mfa-policy') return Promise.reject(new ApiError('NETWORK_ERROR', 'เชื่อมต่อระบบไม่สำเร็จ'));
      return Promise.resolve(ME);
    });
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('mfa-required')).toHaveTextContent('true'));
  });

  /**
   * เครื่องที่เพิ่งตื่นจากพักหน้าจอมักยิง request แรกไม่ติดเพราะสัญญาณยังไม่กลับมา
   * ถ้าปล่อยให้ความล้มเหลวชั่วคราวตั้ง mfaRequired = true ผู้ใช้ที่ทำงานค้างอยู่จะถูกเด้งไป /mfa
   * ทั้งที่สิทธิ์ไม่ได้เปลี่ยนอะไร — Backend ตรวจระดับ AAL ซ้ำทุก request อยู่แล้ว
   */
  it('คงคำตอบเดิมไว้เมื่อเคยตรวจผ่านแล้วและรอบใหม่ล้มเพราะเครือข่าย', async () => {
    renderProvider();
    await waitForInitialLoad();
    expect(screen.getByTestId('mfa-required')).toHaveTextContent('false');

    mocks.apiFetch.mockImplementation((path: string) => {
      if (path === '/api/v1/auth/mfa-policy') return Promise.reject(new ApiError('REQUEST_TIMEOUT', 'การเชื่อมต่อใช้เวลานานเกินไป'));
      return Promise.resolve(ME);
    });
    await act(async () => {
      await refreshMfa();
    });

    expect(screen.getByTestId('mfa-required')).toHaveTextContent('false');
    expect(screen.getByTestId('mfa-loading')).toHaveTextContent('false');
  });

  it('ยังกันไว้ก่อนเมื่อเซิร์ฟเวอร์ตอบกลับมาเป็นความผิดพลาดจริง ไม่ใช่เครือข่ายสะดุด', async () => {
    renderProvider();
    await waitForInitialLoad();

    mocks.apiFetch.mockImplementation((path: string) => {
      if (path === '/api/v1/auth/mfa-policy') return Promise.reject(new ApiError('HTTP_ERROR', 'บริการขัดข้องชั่วคราว', 500));
      return Promise.resolve(ME);
    });
    await act(async () => {
      await refreshMfa();
    });

    expect(screen.getByTestId('mfa-required')).toHaveTextContent('true');
  });
});
