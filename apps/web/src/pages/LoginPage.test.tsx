import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

const apiFetchMock = vi.fn();
const { setSessionMock } = vi.hoisted(() => ({ setSessionMock: vi.fn() }));

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { setSession: (...args: unknown[]) => setSessionMock(...args) } },
}));

vi.mock('../services/apiClient', async () => {
  const actual = await vi.importActual<typeof import('../services/apiClient')>('../services/apiClient');
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
    showToast: vi.fn(),
  };
});

beforeEach(() => {
  apiFetchMock.mockReset();
  setSessionMock.mockReset();
  window.turnstile = {
    render: vi.fn((_container, options) => {
      options.callback('login-captcha-token');
      return 'login-test-widget';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  delete window.turnstile;
});

describe('LoginPage', () => {
  it('forwards Turnstile to the request that verifies the password', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/resolve-login')) return { challenge: 'a'.repeat(64) };
      if (path.endsWith('/login')) return { session: { access_token: 'access-token', refresh_token: 'refresh-token' } };
      if (path.endsWith('/mfa-policy')) return { required: false, reason: null, enrolled: false, currentLevel: 'aal1', needsEnrollment: false };
      if (path.endsWith('/login-log')) return { recorded: true };
      throw new Error(`Unexpected path ${path}`);
    });
    setSessionMock.mockResolvedValue({ error: null });

    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('อีเมล หรือ ชื่อผู้ใช้'), { target: { value: 'somchai.j' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'correct-password' } });
    const submit = screen.getByRole('button', { name: 'เข้าสู่ระบบ' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(setSessionMock).toHaveBeenCalledWith({ access_token: 'access-token', refresh_token: 'refresh-token' }));
    const resolveCall = apiFetchMock.mock.calls.find(([path]) => path.endsWith('/resolve-login'));
    expect(JSON.parse(resolveCall?.[1]?.body)).toEqual({ identifier: 'somchai.j' });
    const loginCall = apiFetchMock.mock.calls.find(([path]) => path.endsWith('/login'));
    expect(JSON.parse(loginCall?.[1]?.body)).toEqual({
      identifier: 'somchai.j',
      password: 'correct-password',
      challenge: 'a'.repeat(64),
      turnstileToken: 'login-captcha-token',
    });
  });
});
