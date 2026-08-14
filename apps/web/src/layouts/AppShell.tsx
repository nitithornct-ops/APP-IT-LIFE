import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { CommandPalette } from '../components/shell/CommandPalette';
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Dashboard and My Tasks already own purpose-built hero sections. Every other
  // authenticated route receives the shared module treatment from the shell.
  const hasNativeHero = location.pathname === '/' || location.pathname === '/tasks';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <a href="#main-content" className="skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>

      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className={cn('flex min-h-screen flex-col transition-all duration-300', collapsed ? 'lg:ml-[78px]' : 'lg:ml-[264px]')}>
        <Topbar onOpenMobileMenu={() => setMobileMenuOpen(true)} onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
        <main id="main-content" className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
          <div className="module-page-content" data-module-themed={!hasNativeHero}>
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
