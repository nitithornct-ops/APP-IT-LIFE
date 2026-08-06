import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
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
        <main id="main-content" className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
