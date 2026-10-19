import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useNavItems } from '../../hooks/useNavItems';
import { apiFetch } from '../../services/apiClient';
import type { BrandingSettings } from '../../types/settings';
import { cn } from '../../utils/cn';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const SIDEBAR_GROUPS_KEY = 'itlife-sidebar-closed-groups';

function readClosedGroups(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(SIDEBAR_GROUPS_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function pathMatches(pathname: string, path: string): boolean {
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const groups = useNavItems();
  const location = useLocation();
  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => apiFetch<BrandingSettings>('/api/v1/settings/branding'),
    staleTime: 5 * 60 * 1000,
  });
  const navRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });
  const [logoFailed, setLogoFailed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>(readClosedGroups);
  const logoUrl = brandingQuery.data?.logoUrl ?? '';
  const organizationName = brandingQuery.data?.organizationName || 'LIFE IT';

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!mobileOpen || desktop) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const sidebar = sidebarRef.current;
    sidebar?.querySelector<HTMLButtonElement>('[data-drawer-close]')?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !sidebar) return;
      const controls = Array.from(sidebar.querySelectorAll<HTMLElement>('button, a[href]'))
        .filter((element) => getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    sidebar?.addEventListener('keydown', trapFocus);
    return () => {
      sidebar?.removeEventListener('keydown', trapFocus);
      previousFocus?.focus();
    };
  }, [desktop, mobileOpen]);

  useEffect(() => setLogoFailed(false), [logoUrl]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(closedGroups));
  }, [closedGroups]);

  useEffect(() => {
    const activeGroup = groups.find((group) => group.items.some((item) => pathMatches(location.pathname, item.path)));
    if (activeGroup) setClosedGroups((current) => current.filter((title) => title !== activeGroup.title));
  }, [groups, location.pathname]);

  const toggleGroup = (title: string) => {
    setClosedGroups((current) => current.includes(title)
      ? current.filter((item) => item !== title)
      : [...current, title]);
  };

  const updateScrollEdges = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;

    setScrollEdges({
      top: nav.scrollTop > 2,
      bottom: nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2,
    });
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const frame = window.requestAnimationFrame(updateScrollEdges);
    const resizeObserver = new ResizeObserver(updateScrollEdges);
    resizeObserver.observe(nav);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [groups, collapsed, mobileOpen, updateScrollEdges]);

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="ปิดเมนู"
          onClick={onCloseMobile}
          className="fixed inset-0 z-mobile-backdrop bg-slate-900/50 backdrop-blur-sm lg:hidden"
        />
      )}

      {/*
        collapsed ใช้ผลกับหน้าจอ lg+ เท่านั้น (เติม lg: นำหน้าทุกคลาส) — บนมือถือ off-canvas
        ต้องแสดงเต็มรูปแบบพร้อมป้ายชื่อเสมอไม่ว่าจะเคยย่อเมนูไว้บนเดสก์ท็อปหรือไม่ (พฤติกรรมเดียวกับระบบเดิม)
      */}
      <aside
        ref={sidebarRef}
        id="app-sidebar"
        aria-label="เมนูหลัก"
        role={mobileOpen && !desktop ? 'dialog' : undefined}
        aria-modal={mobileOpen && !desktop ? true : undefined}
        className={cn(
          'fixed inset-y-0 left-0 flex w-[240px] max-w-[calc(100vw-48px)] flex-col border-r border-white/[.07] bg-primary-900 text-white shadow-[8px_0_28px_rgba(16,42,92,.12)] transition-[transform,width] duration-200 motion-reduce:transition-none dark:bg-primary-950 dark:text-[#e8eef9] lg:z-sidebar',
          collapsed && 'lg:w-16',
          mobileOpen ? 'visible z-mobile-drawer translate-x-0' : 'invisible -translate-x-full lg:visible lg:translate-x-0',
        )}
      >
        <div className="flex min-h-[var(--app-header-height,64px)] items-center gap-2.5 border-b border-white/[.07] px-3">
          <div className={cn(
            'flex h-9 w-9 min-w-9 items-center justify-center overflow-hidden rounded-xl border text-xs font-bold shadow-nav',
            logoUrl && !logoFailed ? 'border-white/20 bg-white p-1' : 'border-primary-500 bg-primary-700 text-white',
          )}>
            {logoUrl && !logoFailed
              ? <img src={logoUrl} alt="" className="h-full w-full object-contain" onError={() => setLogoFailed(true)} />
              : 'LI'}
          </div>
          <div className={cn('min-w-0 leading-tight', collapsed && 'lg:hidden')}>
            <p className="truncate text-sm font-bold leading-6 text-white" title={organizationName}>{organizationName}</p>
            <p className="truncate text-xs font-medium leading-5 text-white/70">ศูนย์บริการไอที</p>
          </div>
          <button type="button" data-drawer-close onClick={onCloseMobile} aria-label="ปิดเมนูหลัก" className="ml-auto flex h-11 min-h-[44px] w-11 min-w-[44px] shrink-0 items-center justify-center rounded-xl text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white lg:hidden"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>

        <div className="relative min-h-0 flex-1">
          <nav
            ref={navRef}
            onScroll={updateScrollEdges}
            className="sidebar-scrollbar h-full overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-3"
            aria-label="เมนูหลัก"
          >
            {groups.map((group) => {
              const groupClosed = closedGroups.includes(group.title);
              const groupActive = group.items.some((item) => pathMatches(location.pathname, item.path));
              return (
              <section key={group.title} className="mb-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title)}
                  aria-expanded={!groupClosed}
                  className={cn(
                    'flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold leading-5 text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                    collapsed && 'lg:hidden',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', groupActive ? 'bg-primary-400' : 'bg-white/20')} aria-hidden="true" />
                  <span className="min-w-0 flex-1 break-words">{group.title}</span>
                  <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform duration-200', groupClosed && '-rotate-90')} aria-hidden="true" />
                </button>
                <div className={cn(
                  'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                  groupClosed ? 'invisible grid-rows-[0fr] opacity-60' : 'visible grid-rows-[1fr] opacity-100',
                  collapsed && 'lg:visible lg:grid-rows-[1fr] lg:opacity-100',
                )}>
                  <div className="min-h-0 overflow-hidden">
                  {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onCloseMobile}
                    title={item.label}
                    aria-label={item.label}
                    className={({ isActive }) =>
                      cn(
                        'group/nav my-0.5 flex min-h-[44px] items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium leading-5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                        collapsed && 'lg:mx-auto lg:w-11 lg:justify-center lg:px-0',
                        isActive
                          ? 'bg-primary-700 font-semibold text-white shadow-nav'
                          : 'text-white/80 hover:bg-white/[.07] hover:text-white',
                      )
                    }
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0 text-current transition-colors" aria-hidden="true" />
                    <span className={cn('min-w-0 break-words', collapsed && 'lg:hidden')}>{item.label}</span>
                    <span className={cn('ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500 opacity-0', collapsed && 'lg:hidden', groupActive && pathMatches(location.pathname, item.path) && 'opacity-100')} aria-hidden="true" />
                  </NavLink>
                  ))}
                  </div>
                </div>
              </section>
            );})}
          </nav>

          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-3 top-0 h-5 bg-gradient-to-b from-primary-900 to-transparent transition-opacity duration-200 dark:from-primary-950',
              scrollEdges.top ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-3 bottom-0 h-6 bg-gradient-to-t from-primary-900 to-transparent transition-opacity duration-200 dark:from-primary-950',
              scrollEdges.bottom ? 'opacity-100' : 'opacity-0',
            )}
          />
        </div>

        <div className="hidden min-h-16 items-center border-t border-white/[.07] px-2 lg:flex">
          <span className={cn('flex-1 px-1 text-xs font-medium text-white/60', collapsed && 'hidden')}>LIFE IT · พร้อมให้บริการ</span>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-xl text-white/70 hover:bg-white/[.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
            title={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden="true" /> : <ChevronsLeft className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </aside>
    </>
  );
}
