import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { CommandPalette } from '../components/shell/CommandPalette';
import { MobileBottomNav } from '../components/shell/MobileBottomNav';
import { Sidebar } from '../components/shell/Sidebar';
import { Topbar } from '../components/shell/Topbar';
import { cn } from '../utils/cn';

const SIDEBAR_COLLAPSED_KEY = 'itlife-sidebar-collapsed';

/**
 * โครงแอปถาวร (Sidebar + Topbar) แทนที่ AppLayout ชั่วคราวของ Phase 3 — ทุกหน้าที่ต้อง Login
 * ใช้โครงนี้ร่วมกันผ่าน Layout Route เดียวกัน
 */
export function AppShell() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const syncBodyLock = () => {
      document.body.style.overflow = window.innerWidth >= 1024 ? previousOverflow : 'hidden';
    };

    syncBodyLock();
    window.addEventListener('resize', syncBodyLock);
    return () => {
      window.removeEventListener('resize', syncBodyLock);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  // Dashboard owns a purpose-built hero. Other authenticated routes receive
  // the shared module treatment from the shell.
  const hasNativeHero = location.pathname === '/';

  return (
    <div className="life-app relative min-h-screen bg-surface-page dark:bg-[#060d1c]">
      <div className="life-app-background" aria-hidden="true" />
      <a href="#main-content" className="skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>

      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className={cn('flex min-h-screen min-w-0 flex-col transition-all duration-200', collapsed ? 'lg:ml-14' : 'lg:ml-[216px]')}>
        <Topbar
          mobileMenuOpen={mobileMenuOpen}
          onOpenMobileMenu={() => setMobileMenuOpen((open) => !open)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />
        <main id="main-content" className="relative min-w-0 flex-1 px-3 py-3 sm:px-[18px] sm:py-4">
          <div className="module-page-content min-w-0" data-module-themed={!hasNativeHero}>
            <Outlet />
          </div>
        </main>
      </div>

      <MobileBottomNav />
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
