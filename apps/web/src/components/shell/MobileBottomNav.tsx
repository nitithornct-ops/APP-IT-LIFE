import { UserCircle } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { NavItem } from '../../config/navigation';
import { useNavItems } from '../../hooks/useNavItems';
import { cn } from '../../utils/cn';

const PREFERRED_ITEMS = [
  { path: '/', shortLabel: 'Home' },
  { path: '/my-work', shortLabel: 'My Work' },
  { path: '/tickets', shortLabel: 'Ticket' },
  { path: '/service-requests', shortLabel: 'Services' },
] as const;

export function MobileBottomNav() {
  const available = useNavItems().flatMap((group) => group.items);
  const items: Array<NavItem & { shortLabel: string }> = PREFERRED_ITEMS.flatMap((target) => {
    const item = available.find((candidate) => candidate.path === target.path);
    return item ? [{ ...item, shortLabel: target.shortLabel }] : [];
  });
  items.push({ label: 'โปรไฟล์ของฉัน', shortLabel: 'Profile', path: '/profile', icon: UserCircle });

  return (
    <nav className="life-bottom-nav fixed inset-x-0 bottom-0 z-30 grid min-h-[68px] border-t px-1 pb-[env(safe-area-inset-bottom)] md:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} aria-label="เมนูหลักบนมือถือ">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) => cn(
            'relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold text-slate-500 transition-colors',
            isActive ? 'text-primary-700 dark:text-primary-300' : 'hover:text-primary-700 dark:text-slate-400',
          )}
        >
          {({ isActive }) => (
            <>
              <span className={cn('absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary-500 transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
              <item.icon className="h-5 w-5" aria-hidden="true" />
              <span className="truncate">{item.shortLabel}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
