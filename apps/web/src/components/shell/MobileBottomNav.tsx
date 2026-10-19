import { UserCircle } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { NavItem } from '../../config/navigation';
import { useNavItems } from '../../hooks/useNavItems';
import { cn } from '../../utils/cn';

const PREFERRED_ITEMS = [
  { path: '/', shortLabel: 'หน้าหลัก' },
  { path: '/my-work', shortLabel: 'งานของฉัน' },
  { path: '/tickets', shortLabel: 'แจ้งซ่อม' },
  { path: '/service-requests', shortLabel: 'ขอบริการ' },
] as const;

export function MobileBottomNav() {
  const available = useNavItems().flatMap((group) => group.items);
  const items: Array<NavItem & { shortLabel: string }> = PREFERRED_ITEMS.flatMap((target) => {
    const item = available.find((candidate) => candidate.path === target.path);
    return item ? [{ ...item, shortLabel: target.shortLabel }] : [];
  });
  items.push({ label: 'โปรไฟล์ของฉัน', shortLabel: 'โปรไฟล์', path: '/profile', icon: UserCircle });

  return (
    <nav className="life-bottom-nav fixed inset-x-0 bottom-0 z-sidebar grid min-h-[68px] border-t px-1 pb-[env(safe-area-inset-bottom)] sm:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} aria-label="เมนูหลักบนมือถือ">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          aria-label={item.label}
          end={item.path === '/'}
          className={({ isActive }) => cn(
            'relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs font-semibold leading-5 text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
            isActive ? 'text-primary-700 dark:text-primary-300' : 'hover:text-primary-700 dark:text-slate-400',
          )}
        >
          {({ isActive }) => (
            <>
              <span className={cn('absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary-500 transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
              <item.icon className="h-5 w-5" aria-hidden="true" />
              <span className="min-h-8 max-w-full break-words text-center leading-4">{item.shortLabel}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
