import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useNavItems } from '../../hooks/useNavItems';
import { cn } from '../../utils/cn';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const groups = useNavItems();

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
          <div className="flex h-10 w-10 min-w-[2.5rem] items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-300 text-sm font-extrabold text-white shadow-lg shadow-primary-500/30">
            LI
          </div>
          <div className={cn('min-w-0 leading-tight', collapsed && 'lg:hidden')}>
            <p className="truncate text-sm font-bold text-white">LIFE IT</p>
            <p className="truncate text-xs text-slate-400">Smart Service Center</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3" aria-label="เมนูหลัก">
          {groups.map((group) => (
            <div key={group.title} className="mb-1">
              <p
                className={cn(
                  'px-3 pb-1 pt-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-500',
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
                      'my-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                      collapsed && 'lg:justify-center lg:px-0',
                      isActive
                        ? 'bg-gradient-to-r from-primary-600 to-primary-700 text-white shadow-lg shadow-primary-900/30'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white',
                    )
                  }
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

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
