import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineCallbackPage } from './LineCallbackPage';

const { setLineSessionTokenMock } = vi.hoisted(() => ({ setLineSessionTokenMock: vi.fn() }));

vi.mock('../services/lineApiClient', () => ({ setLineSessionToken: setLineSessionTokenMock }));

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

describe('LineCallbackPage', () => {
  it('returns a successful report login to the shared report form', async () => {
    window.history.replaceState({}, '', '/line/callback#token=session-token&mode=report');

    render(
      <MemoryRouter initialEntries={['/line/callback']}>
        <Routes>
          <Route path="/line/callback" element={<LineCallbackPage />} />
          <Route path="/report" element={<p>shared report form</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('shared report form')).toBeVisible();
    await waitFor(() => expect(setLineSessionTokenMock).toHaveBeenCalledWith('session-token'));
  });
});
