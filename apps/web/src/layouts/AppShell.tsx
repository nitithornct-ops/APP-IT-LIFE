import { Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { CommandPalette } from '../components/shell/CommandPalette';
import { MobileBottomNav } from '../components/shell/MobileBottomNav';
import { Sidebar } from '../components/shell/Sidebar';
import { Topbar } from '../components/shell/Topbar';
import { cn } from '../utils/cn';
import { LoadingState } from '../components/ui/AsyncState';

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
  const closeCommandPalette = useCallback(() => setCommandPaletteOpen(false), []);
  const openCommandPalette = useCallback(() => {
    setMobileMenuOpen(false);
    setCommandPaletteOpen(true);
  }, []);

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
        openCommandPalette();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen, openCommandPalette]);

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

      <div className={cn('flex min-h-screen min-w-0 flex-col transition-[margin] duration-200 motion-reduce:transition-none', collapsed ? 'lg:ml-16' : 'lg:ml-60')}>
        <Topbar
          mobileMenuOpen={mobileMenuOpen}
          onOpenMobileMenu={() => setMobileMenuOpen((open) => !open)}
          onOpenCommandPalette={openCommandPalette}
        />
        <main id="main-content" className="relative min-w-0 flex-1 px-3 py-3 sm:px-[18px] sm:py-4">
          <div className="module-page-content min-w-0" data-module-themed={!hasNativeHero}>
            <Suspense fallback={<LoadingState label="กำลังเปิดหน้า..." rows={3} />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      <MobileBottomNav />
      <CommandPalette open={commandPaletteOpen} onClose={closeCommandPalette} />
    </div>
  );
}
