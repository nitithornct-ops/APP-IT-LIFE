import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineCallbackPage } from './LineCallbackPage';

const { setLineSessionTokenMock, clearLineSessionTokenMock, apiFetchMock } = vi.hoisted(() => ({
  setLineSessionTokenMock: vi.fn(),
  clearLineSessionTokenMock: vi.fn(),
  apiFetchMock: vi.fn(),
}));

vi.mock('../services/lineApiClient', () => ({
  setLineSessionToken: setLineSessionTokenMock,
  clearLineSessionToken: clearLineSessionTokenMock,
}));
vi.mock('../services/apiClient', () => ({ apiFetch: apiFetchMock }));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

function ProfileProbe() {
  const location = useLocation();
  return <p>{`profile${location.search}`}</p>;
}

function renderCallback(hash: string) {
  window.history.replaceState({}, '', `/line/callback${hash}`);

  render(
    <MemoryRouter initialEntries={['/line/callback']}>
      <Routes>
        <Route path="/line/callback" element={<LineCallbackPage />} />
        <Route path="/line" element={<p>line portal</p>} />
        <Route path="/report" element={<p>shared report form</p>} />
        <Route path="/profile" element={<ProfileProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LineCallbackPage', () => {
  // /report เป็นช่องทาง guest ล้วน — ผู้ใช้ LINE ต้องจบที่พอร์ทัล LINE ไม่ว่า returnMode จะเป็นอะไร
  it('returns a successful report login to the LINE portal, not the guest form', async () => {
    renderCallback('#token=session-token&mode=report');

    expect(await screen.findByText('line portal')).toBeVisible();
    expect(screen.queryByText('shared report form')).not.toBeInTheDocument();
    await waitFor(() => expect(setLineSessionTokenMock).toHaveBeenCalledWith('session-token'));
  });

  it('keeps the requested tab in the query so the portal can open it', async () => {
    renderCallback('#token=session-token&mode=kb');

    expect(await screen.findByText('line portal')).toBeVisible();
    await waitFor(() => expect(setLineSessionTokenMock).toHaveBeenCalledWith('session-token'));
  });
});

describe('LineCallbackPage · เชื่อมบัญชีด้วยตัวเอง', () => {
  it('links the account with both credentials, then returns to the profile page', async () => {
    apiFetchMock.mockResolvedValue({ account: { id: 'line-1' } });
    renderCallback('#token=session-token&mode=link');

    expect(await screen.findByText('profile?line=linked')).toBeVisible();
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/line/my-link',
      expect.objectContaining({ method: 'POST', headers: { 'x-line-session': 'session-token' } }),
      { silent: true },
    );
    // พอร์ทัล LINE ไม่ใช่ปลายทางของโหมดนี้ — เก็บ session ไว้ต่อจะสับสนกับบัญชีผู้ใช้ในแอป
    await waitFor(() => expect(clearLineSessionTokenMock).toHaveBeenCalled());
  });

  it('reports a rejected link on the profile page instead of failing silently', async () => {
    apiFetchMock.mockRejectedValue(new Error('LINE_ACCOUNT_LINKED_ELSEWHERE'));
    renderCallback('#token=session-token&mode=link');

    expect(await screen.findByText('profile?line=error')).toBeVisible();
    expect(clearLineSessionTokenMock).not.toHaveBeenCalled();
  });

  it('never calls the link endpoint when LINE returned no session at all', async () => {
    renderCallback('#error=%E0%B9%84%E0%B8%A1%E0%B9%88%E0%B8%AA%E0%B8%B3%E0%B9%80%E0%B8%A3%E0%B9%87%E0%B8%88&mode=link');

    expect(await screen.findByText('profile?line=error')).toBeVisible();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
