import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronsLeft, ChevronsRight } from 'lucide-react';
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
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });
  const [logoFailed, setLogoFailed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>(readClosedGroups);
  const logoUrl = brandingQuery.data?.logoUrl ?? '';
  const organizationName = brandingQuery.data?.organizationName || 'LIFE IT';

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
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm lg:hidden"
        />
      )}

      {/*
        collapsed ใช้ผลกับหน้าจอ lg+ เท่านั้น (เติม lg: นำหน้าทุกคลาส) — บนมือถือ off-canvas
        ต้องแสดงเต็มรูปแบบพร้อมป้ายชื่อเสมอไม่ว่าจะเคยย่อเมนูไว้บนเดสก์ท็อปหรือไม่ (พฤติกรรมเดียวกับระบบเดิม)
      */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[216px] flex-col border-r border-white/[.07] bg-[#0b1b36] text-white shadow-[8px_0_28px_rgba(11,27,54,.12)] transition-all duration-200 dark:bg-[#060d1c] dark:text-[#e8eef9]',
          collapsed && 'lg:w-14',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex h-[46px] min-h-[46px] items-center gap-2.5 border-b border-white/[.07] px-[13px]">
          <div className={cn(
            'flex h-[30px] w-[30px] min-w-[30px] items-center justify-center overflow-hidden rounded-[9px] border text-[11px] font-extrabold shadow-nav',
            logoUrl && !logoFailed ? 'border-white/20 bg-white p-1' : 'border-primary-500 bg-primary-700 text-white',
          )}>
            {logoUrl && !logoFailed
              ? <img src={logoUrl} alt="" className="h-full w-full object-contain" onError={() => setLogoFailed(true)} />
              : 'LI'}
          </div>
          <div className={cn('min-w-0 leading-tight', collapsed && 'lg:hidden')}>
            <p className="truncate text-[13px] font-extrabold text-white" title={organizationName}>{organizationName}</p>
            <p className="truncate font-mono text-[9px] font-medium tracking-wide text-white/45">SMART SERVICE CENTER</p>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <nav
            ref={navRef}
            onScroll={updateScrollEdges}
            className={cn('sidebar-scrollbar h-full overflow-y-auto overflow-x-hidden overscroll-contain py-3', collapsed ? 'px-3' : 'px-2.5')}
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
                    'flex min-h-8 w-full items-center gap-2 px-2 py-1 text-left font-mono text-[9px] font-semibold uppercase leading-4 tracking-[0.1em] text-white/35 transition-colors hover:text-white/75',
                    collapsed && 'lg:hidden',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', groupActive ? 'bg-primary-400' : 'bg-white/20')} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{group.title}</span>
                  <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform duration-200', groupClosed && '-rotate-90')} aria-hidden="true" />
                </button>
                <div className={cn(
                  'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                  groupClosed ? 'grid-rows-[0fr] opacity-60' : 'grid-rows-[1fr] opacity-100',
                  collapsed && 'lg:grid-rows-[1fr] lg:opacity-100',
                )}>
                  <div className="min-h-0 overflow-hidden">
                  {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onCloseMobile}
                    title={item.label}
                    className={({ isActive }) =>
                      cn(
                        'group/nav my-0.5 flex min-h-9 items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-[12.5px] font-medium leading-4 transition-[background-color,color,box-shadow,transform] duration-150 ease-out',
                        collapsed && 'lg:mx-auto lg:w-8 lg:justify-center lg:px-0',
                        isActive
                          ? 'bg-primary-700 font-semibold text-white shadow-nav'
                          : 'text-white/62 hover:translate-x-0.5 hover:bg-white/[.07] hover:text-white',
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0 text-current transition-colors" aria-hidden="true" />
                    <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
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
              'pointer-events-none absolute inset-x-3 top-0 h-5 bg-gradient-to-b from-[#0b1b36] to-transparent transition-opacity duration-200 dark:from-[#060d1c]',
              scrollEdges.top ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-3 bottom-0 h-6 bg-gradient-to-t from-[#0b1b36] to-transparent transition-opacity duration-200 dark:from-[#060d1c]',
              scrollEdges.bottom ? 'opacity-100' : 'opacity-0',
            )}
          />
        </div>

        <div className="hidden min-h-[46px] items-center border-t border-white/[.07] px-2 lg:flex">
          <span className={cn('flex-1 px-1 font-mono text-[9px] font-medium text-white/30', collapsed && 'hidden')}>LIFE IT · SERVICE READY</span>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] text-white/45 hover:bg-white/[.08] hover:text-white"
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
