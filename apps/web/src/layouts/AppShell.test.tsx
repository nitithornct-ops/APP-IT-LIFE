import { lazy } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('../components/shell/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../components/shell/Topbar', () => ({ Topbar: () => null }));
vi.mock('../components/shell/MobileBottomNav', () => ({ MobileBottomNav: () => null }));
vi.mock('../components/shell/CommandPalette', () => ({ CommandPalette: () => null }));

afterEach(cleanup);

describe('AppShell route loading', () => {
  it('shows a loading state for a lazy route and then renders the page', async () => {
    let finishLoading: (() => void) | undefined;
    const LazyRoute = lazy(() => new Promise<{ default: () => JSX.Element }>((resolve) => {
      finishLoading = () => resolve({ default: () => <h1>War Room พร้อมใช้งาน</h1> });
    }));
    render(<MemoryRouter initialEntries={['/war-room']}><Routes><Route element={<AppShell />}><Route path="/war-room" element={<LazyRoute />} /></Route></Routes></MemoryRouter>);

    expect(await screen.findByRole('status', { name: 'กำลังเปิดหน้า...' })).toBeInTheDocument();
    await act(async () => finishLoading?.());
    expect(await screen.findByRole('heading', { name: 'War Room พร้อมใช้งาน' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'กำลังเปิดหน้า...' })).not.toBeInTheDocument();
  });
});
