import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileBottomNav } from './MobileBottomNav';
import { Topbar } from './Topbar';

const signOut = vi.fn();
const navigation = vi.hoisted(() => ({
  items: [
    { label: 'หน้าหลัก', path: '/', icon: () => null },
    { label: 'งานของฉัน', path: '/my-work', icon: () => null },
    { label: 'แจ้งซ่อม', path: '/tickets', icon: () => null },
    { label: 'คำขอบริการ', path: '/service-requests', icon: () => null },
  ],
}));

vi.mock('../../hooks/useNavItems', () => ({
  useNavItems: () => [{ title: 'งานบริการ', items: navigation.items }],
}));
vi.mock('../../stores/authContext', () => ({
  useAuth: () => ({ me: { profile: { full_name: 'ผู้ใช้ ทดสอบ' }, roles: [{ role_name_th: 'เจ้าหน้าที่' }] }, signOut }),
}));
vi.mock('../NotificationBell', () => ({ NotificationBell: () => <button aria-label="การแจ้งเตือน" /> }));
vi.mock('./ThemeToggle', () => ({ ThemeToggle: () => <button aria-label="ธีม" /> }));
vi.mock('./FontSizeControl', () => ({ FontSizeControl: () => <div /> }));

afterEach(() => {
  cleanup();
  signOut.mockReset();
});

function renderTopbar() {
  return render(
    <MemoryRouter initialEntries={['/tickets']}>
      <Topbar mobileMenuOpen={false} onOpenMobileMenu={() => undefined} onOpenCommandPalette={() => undefined} />
      <Routes><Route path="/profile" element={<p>หน้าโปรไฟล์</p>} /><Route path="*" element={null} /></Routes>
    </MemoryRouter>,
  );
}

describe('shell navigation', () => {
  it('keeps sign out behind a labelled account action and lets users reach their profile', () => {
    renderTopbar();
    expect(screen.queryByRole('button', { name: 'ออกจากระบบ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'บัญชีผู้ใช้' }));
    expect(signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'โปรไฟล์ของฉัน' }));
    expect(screen.getByText('หน้าโปรไฟล์')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บัญชีผู้ใช้' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('dismisses account actions on Escape and returns focus to the account button', () => {
    renderTopbar();
    const account = screen.getByRole('button', { name: 'บัญชีผู้ใช้' });
    fireEvent.click(account);
    screen.getByRole('button', { name: 'ออกจากระบบ' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(account).toHaveFocus();
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out only when the user chooses the explicit action', () => {
    renderTopbar();
    fireEvent.click(screen.getByRole('button', { name: 'บัญชีผู้ใช้' }));
    fireEvent.click(screen.getByRole('button', { name: 'ออกจากระบบ' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('uses Thai mobile labels and marks a detail route as part of its list module', () => {
    render(<MemoryRouter initialEntries={['/tickets/ticket-1']}><MobileBottomNav /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'แจ้งซ่อม' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'คำขอบริการ' })).toHaveTextContent('ขอบริการ');
    expect(screen.getByRole('link', { name: 'โปรไฟล์ของฉัน' })).toHaveTextContent('โปรไฟล์');
    expect(screen.getByRole('link', { name: 'หน้าหลัก' })).not.toHaveAttribute('aria-current');
  });

  it('only offers mobile destinations that pass the existing navigation permissions', () => {
    const previous = navigation.items;
    navigation.items = previous.filter((item) => item.path === '/tickets');
    try {
      render(<MemoryRouter><MobileBottomNav /></MemoryRouter>);
      expect(screen.getAllByRole('link')).toHaveLength(2);
      expect(screen.queryByRole('link', { name: 'คำขอบริการ' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'แจ้งซ่อม' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'โปรไฟล์ของฉัน' })).toBeInTheDocument();
    } finally {
      navigation.items = previous;
    }
  });
});
