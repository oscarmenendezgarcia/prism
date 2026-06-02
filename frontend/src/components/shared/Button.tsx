/**
 * Button component with 7 variants for the Apple-inspired design system.
 * ADR-002: replaces .btn .btn-primary etc. CSS classes.
 * ADR-003 §8.6: bg-error token for danger, transition-all ease-apple,
 *   active:scale-[0.97], icon variant w-8 h-8, no hardcoded hex.
 */

import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon' | 'tonal' | 'outlined';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * 'md' (default) = px-4 py-2 text-sm — unchanged from before.
   * 'sm' = compact h-8 px-2.5 text-xs for dense/contextual actions (panel
   * headers) that should align with the 32px icon buttons. Ignored by the
   * `icon` variant (already fixed at 32px).
   */
  size?: ButtonSize;
  children: React.ReactNode;
}

// Shape + behaviour shared by all non-icon variants. Size and colour are layered
// separately so a size override never collides with colour utilities.
const base =
  'inline-flex items-center rounded-md font-medium transition-all duration-150 ease-apple disabled:cursor-not-allowed';

const sizeClasses: Record<ButtonSize, string> = {
  md: 'gap-2 px-4 py-2 text-sm',
  sm: 'gap-1.5 px-2.5 h-8 text-xs',
};

const variantClasses: Record<Exclude<ButtonVariant, 'icon'>, string> = {
  primary:
    'bg-primary text-on-primary shadow-sm hover:bg-primary-hover active:bg-primary-active active:scale-[0.97] disabled:bg-surface-variant disabled:text-text-disabled disabled:opacity-50',
  secondary:
    'bg-surface-variant text-text-secondary border border-border hover:bg-surface disabled:bg-surface-variant disabled:text-text-disabled disabled:opacity-50',
  ghost:
    'bg-transparent text-primary hover:bg-primary/[0.10] disabled:bg-transparent disabled:text-slate-400',
  tonal:
    'bg-primary/[0.12] text-primary hover:bg-primary/[0.20] disabled:bg-surface-variant disabled:text-text-disabled disabled:opacity-50',
  outlined:
    'bg-transparent text-primary border border-border hover:bg-primary/[0.08] disabled:border-border disabled:text-text-disabled disabled:opacity-50',
  danger:
    'bg-error text-white hover:bg-error-hover active:scale-[0.97] disabled:bg-surface-variant disabled:text-text-disabled disabled:opacity-50',
};

// Icon variant is fixed-size (32px) and self-contained — size prop does not apply.
const iconClasses =
  'inline-flex items-center justify-center w-8 h-8 rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 ease-apple text-base leading-none';

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const classes =
    variant === 'icon'
      ? iconClasses
      : `${base} ${sizeClasses[size]} ${variantClasses[variant]}`;
  return (
    <button
      className={`${classes} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
