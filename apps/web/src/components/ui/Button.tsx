import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const variantClasses: Record<Variant, string> = {
  primary: 'bg-primary-700 text-white border border-primary-700 hover:bg-primary-800 shadow-sm',
  secondary: 'bg-slate-700 text-white border border-slate-700 hover:bg-slate-800',
  outline:
    'bg-white text-primary-700 border border-slate-300 hover:bg-primary-50 dark:bg-slate-800 dark:text-primary-300 dark:border-slate-600 dark:hover:bg-slate-700',
  danger: 'bg-red-600 text-white border border-red-600 hover:bg-red-700',
  ghost:
    'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700',
};

const sizeClasses: Record<Size, string> = {
  sm: 'min-h-[34px] px-3 text-sm rounded-lg',
  md: 'min-h-[40px] px-4 text-sm rounded-lg',
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
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || isLoading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
