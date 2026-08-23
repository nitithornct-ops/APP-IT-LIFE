import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'success' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const variantClasses: Record<Variant, string> = {
  primary: 'border border-primary-700 bg-primary-700 text-white shadow-action hover:border-primary-900 hover:bg-primary-900',
  secondary: 'border border-primary-950 bg-primary-950 text-white hover:bg-primary-900',
  outline:
    'bg-white text-slate-700 border border-slate-300 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700',
  success: 'border border-success-600 bg-success-600 text-white hover:bg-success-700 dark:border-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400',
  danger: 'border border-danger-700 bg-danger-700 text-white hover:bg-danger-600 dark:border-red-400 dark:bg-red-400 dark:text-slate-950 dark:hover:bg-red-300',
  ghost:
    'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700',
};

const sizeClasses: Record<Size, string> = {
  sm: 'min-h-9 rounded-[7px] px-3 text-xs',
  md: 'min-h-10 rounded-[7px] px-4 text-[13.5px]',
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
      data-ui="button"
      disabled={disabled || isLoading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
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
