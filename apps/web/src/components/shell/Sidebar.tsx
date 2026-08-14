import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { NavLink } from 'react-router-dom';
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

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const groups = useNavItems();
  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => apiFetch<BrandingSettings>('/api/v1/settings/branding'),
    staleTime: 5 * 60 * 1000,
  });
  const navRef = useRef<HTMLElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });
  const [logoFailed, setLogoFailed] = useState(false);
  const logoUrl = brandingQuery.data?.logoUrl ?? '';
  const organizationName = brandingQuery.data?.organizationName || 'LIFE IT';

  useEffect(() => setLogoFailed(false), [logoUrl]);

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
          'fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col bg-gradient-to-b from-sidebar to-sidebar-light text-slate-300 shadow-2xl transition-all duration-300',
          collapsed && 'lg:w-[78px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex min-h-[64px] items-center gap-3 border-b border-white/10 px-4">
          <div className={cn(
            'flex h-10 w-10 min-w-[2.5rem] items-center justify-center overflow-hidden rounded-xl text-sm font-extrabold shadow-lg',
            logoUrl && !logoFailed ? 'bg-white p-1 shadow-slate-950/20' : 'bg-gradient-to-br from-primary-500 to-primary-300 text-white shadow-primary-500/30',
          )}>
            {logoUrl && !logoFailed
              ? <img src={logoUrl} alt="" className="h-full w-full object-contain" onError={() => setLogoFailed(true)} />
              : 'LI'}
          </div>
          <div className={cn('min-w-0 leading-tight', collapsed && 'lg:hidden')}>
            <p className="truncate text-sm font-bold text-white" title={organizationName}>{organizationName}</p>
            <p className="truncate text-xs text-slate-400">Smart Service Center</p>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <nav
            ref={navRef}
            onScroll={updateScrollEdges}
            className="sidebar-scrollbar h-full overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2"
            aria-label="เมนูหลัก"
          >
            {groups.map((group) => (
              <div key={group.title} className="mb-0.5">
                <p
                  className={cn(
                    'px-2.5 pb-0.5 pt-2 text-[10px] font-extrabold uppercase leading-4 tracking-wide text-slate-500',
                    collapsed && 'lg:hidden',
                  )}
                >
                  {group.title}
                </p>
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onCloseMobile}
                    title={item.label}
                    className={({ isActive }) =>
                      cn(
                        'my-px flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium leading-5 transition-all duration-200 ease-out',
                        collapsed && 'lg:mx-auto lg:w-10 lg:justify-center lg:px-0',
                        isActive
                          ? 'bg-gradient-to-r from-primary-600 to-primary-700 text-white shadow-md shadow-primary-900/25'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white',
                      )
                    }
                  >
                    <item.icon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
                    <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-sidebar to-transparent transition-opacity duration-200',
              scrollEdges.top ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-sidebar-light to-transparent transition-opacity duration-200',
              scrollEdges.bottom ? 'opacity-100' : 'opacity-0',
            )}
          />
        </div>

        <button
          type="button"
          onClick={onToggleCollapsed}
          className="hidden items-center justify-center gap-2 border-t border-white/10 py-3 text-xs font-semibold text-slate-400 hover:bg-white/5 hover:text-white lg:flex"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden="true" /> : <ChevronsLeft className="h-4 w-4" aria-hidden="true" />}
          {!collapsed && 'ย่อเมนู'}
        </button>
      </aside>
    </>
  );
}
