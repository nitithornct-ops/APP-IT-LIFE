import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'success' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const variantClasses: Record<Variant, string> = {
  primary: 'border border-primary-600 bg-primary-600 text-white shadow-action hover:border-primary-700 hover:bg-primary-700',
  secondary: 'border border-primary-950 bg-primary-950 text-white hover:bg-primary-900',
  outline:
    'bg-white text-slate-700 border border-slate-300 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700',
  success: 'border border-success-600 bg-success-600 text-white hover:bg-success-700 dark:border-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400',
  danger: 'border border-danger-700 bg-danger-700 text-white hover:bg-danger-600 dark:border-red-400 dark:bg-red-400 dark:text-slate-950 dark:hover:bg-red-300',
  ghost:
    'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700',
};

const sizeClasses: Record<Size, string> = {
  sm: 'min-h-[var(--ui-control-height)] rounded-life px-3 py-2 text-sm',
  md: 'min-h-[var(--ui-control-height)] rounded-life px-4 py-2 text-base',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      data-ui="button"
      data-variant={variant}
      disabled={disabled || isLoading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
      onClick={(event) => {
        // Safari does not focus buttons on pointer activation. Establish the
        // opener before a dialog mounts so its normal focus restoration works.
        event.currentTarget.focus();
        onClick?.(event);
      }}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
