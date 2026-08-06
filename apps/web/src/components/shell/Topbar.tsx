import { LogOut, Menu, Search } from 'lucide-react';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV_GROUPS } from '../../config/navigation';
import { useAuth } from '../../stores/authContext';
import { NotificationBell } from '../NotificationBell';
import { FontSizeControl } from './FontSizeControl';
import { ThemeToggle } from './ThemeToggle';

function useCurrentPageTitle(): string {
  const location = useLocation();
  return useMemo(() => {
    const allItems = NAV_GROUPS.flatMap((g) => g.items);
    const match = allItems.find((item) => item.path === location.pathname);
    return match?.label ?? 'LIFE IT Smart Service Center';
  }, [location.pathname]);
}

function initialsFrom(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[1][0]}`;
}

interface TopbarProps {
  onOpenMobileMenu: () => void;
  onOpenCommandPalette: () => void;
}

export function Topbar({ onOpenMobileMenu, onOpenCommandPalette }: TopbarProps) {
  const { me, signOut } = useAuth();
  const title = useCurrentPageTitle();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90 sm:px-6">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 lg:hidden"
        aria-label="เปิดเมนู"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-base font-bold text-slate-800 dark:text-slate-100 sm:text-lg">{title}</h1>

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700 md:flex"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        ค้นหาเมนู
        <kbd className="ml-2 rounded border border-slate-300 px-1.5 text-xs dark:border-slate-600">Ctrl K</kbd>
      </button>
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 md:hidden"
        aria-label="ค้นหาเมนู"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>

      <FontSizeControl />
      <ThemeToggle />
      <NotificationBell />

      <div className="ml-1 flex items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-700">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-600 to-primary-400 text-xs font-bold text-white">
          {initialsFrom(me?.profile.full_name)}
        </div>
        <div className="hidden leading-tight sm:block">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{me?.profile.full_name}</p>
          <p className="text-xs text-slate-400">{me?.roles[0]?.role_name_th}</p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950"
          aria-label="ออกจากระบบ"
          title="ออกจากระบบ"
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
