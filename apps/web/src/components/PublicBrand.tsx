import { cn } from '../utils/cn';

interface PublicBrandProps {
  className?: string;
  subtitle?: string;
}

/** Shared public-facing lockup. It deliberately uses the application tokens
 * rather than the protected organization branding endpoint. */
export function PublicBrand({ className, subtitle = 'Smart Service Center' }: PublicBrandProps) {
  return (
    <div className={cn('public-brand-lockup', className)}>
      <span className="public-brand-mark" aria-hidden="true">LI</span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-display text-lg font-semibold tracking-[0.08em] text-primary-900 dark:text-primary-100">LIFE IT</span>
        <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-600">{subtitle}</span>
      </span>
    </div>
  );
}
