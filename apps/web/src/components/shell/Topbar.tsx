import { LogOut, Menu, Search } from 'lucide-react';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV_GROUPS } from '../../config/navigation';
import { useAuth } from '../../stores/authContext';
import { NotificationBell } from '../NotificationBell';
import { FontSizeControl } from './FontSizeControl';
import { ThemeToggle } from './ThemeToggle';

function useCurrentPageContext(): { group: string; page: string } {
  const location = useLocation();
  return useMemo(() => {
    const match = NAV_GROUPS
      .flatMap((group) => group.items.map((item) => ({ group: group.title, item })))
      .filter(({ item }) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`))
      .sort((a, b) => b.item.path.length - a.item.path.length)[0];
    return { group: match?.group ?? 'ระบบจัดการ', page: match?.item.label ?? 'LIFE IT Smart Service Center' };
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
  const context = useCurrentPageContext();

  return (
    <header className="app-topbar sticky top-0 z-20 flex h-[46px] min-h-[46px] items-center gap-2 border-b border-hairline bg-white px-3 dark:border-white/[.07] dark:bg-[#0a1224] sm:px-[18px]">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        className="flex h-8 w-8 items-center justify-center rounded-[7px] text-slate-600 hover:bg-primary-50 hover:text-primary-700 dark:text-slate-300 dark:hover:bg-white/[.07] lg:hidden"
        aria-label="เปิดเมนู"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="min-w-0 flex-1 lg:max-w-[280px]" aria-label={`ระบบจัดการ / ${context.group} / ${context.page}`}>
        <p className="hidden truncate font-mono text-[9px] font-semibold uppercase tracking-[.08em] text-slate-400 dark:text-white/35 sm:block">{context.group}</p>
        <p className="truncate text-[13px] font-bold text-ink-heading dark:text-[#e8eef9]">{context.page}</p>
      </div>

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="life-global-search hidden h-8 min-w-0 flex-1 items-center gap-2 border px-3 text-xs text-slate-500 md:flex lg:max-w-xl"
      >
        <Search className="h-[18px] w-[18px] text-primary-600" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">ค้นหา Ticket, Asset, CI หรือเมนู...</span>
        <kbd className="ml-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-400 shadow-sm dark:border-slate-600 dark:bg-slate-800">Ctrl K</kbd>
      </button>
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="flex h-8 w-8 items-center justify-center rounded-[7px] text-slate-600 hover:bg-primary-50 hover:text-primary-700 dark:text-slate-300 dark:hover:bg-white/[.07] md:hidden"
        aria-label="ค้นหาเมนู"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>

      <FontSizeControl />
      <ThemeToggle />
      <NotificationBell />

      <div className="ml-0.5 flex items-center gap-2 border-l border-slate-200 pl-2.5 dark:border-slate-700">
        <div className="relative flex h-7 w-7 items-center justify-center rounded-full border border-primary-200 bg-[#dbe4f7] text-[9px] font-bold text-primary-700 dark:border-primary-900 dark:bg-[#1e3a6e] dark:text-[#93b4f5]">
          {initialsFrom(me?.profile.full_name)}
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-primary-500 dark:border-slate-800" aria-label="ออนไลน์" />
        </div>
        <div className="hidden leading-tight sm:block">
          <p className="max-w-32 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{me?.profile.full_name}</p>
          <p className="max-w-32 truncate text-[10px] text-slate-400">{me?.roles[0]?.role_name_th}</p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
          aria-label="ออกจากระบบ"
          title="ออกจากระบบ"
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
