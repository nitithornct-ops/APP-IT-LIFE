import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineCallbackPage } from './LineCallbackPage';

const { setLineSessionTokenMock } = vi.hoisted(() => ({ setLineSessionTokenMock: vi.fn() }));

vi.mock('../services/lineApiClient', () => ({ setLineSessionToken: setLineSessionTokenMock }));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

function renderCallback(hash: string) {
  window.history.replaceState({}, '', `/line/callback${hash}`);

  render(
    <MemoryRouter initialEntries={['/line/callback']}>
      <Routes>
        <Route path="/line/callback" element={<LineCallbackPage />} />
        <Route path="/line" element={<p>line portal</p>} />
        <Route path="/report" element={<p>shared report form</p>} />
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
