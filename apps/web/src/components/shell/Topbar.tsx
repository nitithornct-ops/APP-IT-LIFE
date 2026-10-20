import { ChevronDown, LogOut, Menu, Search, UserCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
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
    return { group: match?.group ?? 'ระบบจัดการ', page: location.pathname === '/profile' ? 'โปรไฟล์ของฉัน' : match?.item.label ?? 'LIFE IT Smart Service Center' };
  }, [location.pathname]);
}

function initialsFrom(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[1][0]}`;
}

interface TopbarProps {
  mobileMenuOpen: boolean;
  onOpenMobileMenu: () => void;
  onOpenCommandPalette: () => void;
}

const iconButton = 'flex h-11 min-h-[44px] w-11 min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-300 dark:hover:bg-white/[.07]';

export function Topbar({ mobileMenuOpen, onOpenMobileMenu, onOpenCommandPalette }: TopbarProps) {
  const { me, signOut } = useAuth();
  const context = useCurrentPageContext();
  const location = useLocation();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setAccountOpen(false), [location.pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAccountOpen(false);
      accountButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountOpen]);

  return (
    <header className="app-topbar sticky top-0 z-header flex min-h-[var(--app-header-height,64px)] items-center gap-1 border-b border-hairline bg-white px-2 dark:border-white/[.07] dark:bg-[#0a1224] sm:gap-2 sm:px-[18px]">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        aria-expanded={mobileMenuOpen}
        aria-controls="app-sidebar"
        className={`${iconButton} lg:hidden`}
        aria-label={mobileMenuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="min-w-0 flex-1 lg:max-w-[280px]" aria-label={`${context.group} / ${context.page}`}>
        <p className="hidden truncate text-xs font-medium leading-5 text-slate-500 dark:text-slate-400 sm:block">{context.group}</p>
        <p className="truncate text-sm font-bold leading-6 text-ink-heading dark:text-slate-100" title={context.page}>{context.page}</p>
      </div>

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="life-global-search hidden min-h-[44px] min-w-0 flex-1 items-center gap-2 border px-3 text-sm text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:flex lg:max-w-xl"
      >
        <Search className="h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">ค้นหาใบงาน ทรัพย์สิน CI หรือเมนู...</span>
        <kbd className="ml-1 hidden shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-800 lg:block">Ctrl K</kbd>
      </button>
      <button type="button" onClick={onOpenCommandPalette} className={`${iconButton} md:hidden`} aria-label="ค้นหาเมนูและข้อมูล">
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <FontSizeControl />
        <ThemeToggle />
        <NotificationBell />

        <div className="relative ml-0.5 border-l border-slate-200 pl-1 dark:border-slate-700 sm:pl-2" ref={accountRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false); }}>
          <button
            ref={accountButtonRef}
            type="button"
            onClick={() => setAccountOpen((open) => !open)}
            aria-label="บัญชีผู้ใช้"
            aria-expanded={accountOpen}
            aria-controls="account-actions"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl px-1 text-slate-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-200 dark:hover:bg-white/[.07] sm:px-2"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-xs font-bold text-primary-700 dark:border-primary-900 dark:bg-primary-950 dark:text-primary-300">{initialsFrom(me?.profile.full_name)}</span>
            <span className="hidden min-w-0 text-left xl:block">
              <span className="block max-w-32 truncate text-sm font-semibold">{me?.profile.full_name}</span>
              <span className="block max-w-32 truncate text-xs text-slate-500 dark:text-slate-400">{me?.roles[0]?.role_name_th}</span>
            </span>
            <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" aria-hidden="true" />
          </button>
          {accountOpen && (
            <div id="account-actions" className="absolute right-0 z-dropdown mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-elevated dark:border-slate-700 dark:bg-slate-800">
              <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-700">
                <p className="break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{me?.profile.full_name}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{me?.roles[0]?.role_name_th}</p>
              </div>
              <div className="border-b border-slate-100 px-3 py-3 dark:border-slate-700 sm:hidden"><p className="mb-2 text-sm">ขนาดตัวอักษร</p><FontSizeControl mobile /></div>
              <Link to="/profile" onClick={() => setAccountOpen(false)} className="mt-1 flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-200 dark:hover:bg-slate-700"><UserCircle className="h-4 w-4" aria-hidden="true" />โปรไฟล์ของฉัน</Link>
              <button type="button" onClick={() => { setAccountOpen(false); void signOut(); }} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-300 dark:hover:bg-red-950/40"><LogOut className="h-4 w-4" aria-hidden="true" />ออกจากระบบ</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
