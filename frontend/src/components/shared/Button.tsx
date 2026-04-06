/**
 * Button component with 7 variants for the Apple-inspired design system.
 * ADR-002: replaces .btn .btn-primary etc. CSS classes.
 * ADR-003 §8.6: bg-error token for danger, transition-all ease-apple,
 *   active:scale-[0.97], icon variant w-8 h-8, no hardcoded hex.
 */

import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon' | 'tonal' | 'outlined';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm bg-primary text-on-primary shadow-sm hover:bg-primary-hover active:bg-primary-active active:scale-[0.97] disabled:bg-surface-variant disabled:text-text-disabled disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 ease-apple',
  secondary:
    'inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm bg-surface-variant text-text-secondary border border-border hover:bg-surface disabled:bg-surface-variant disabled:text-text-disabled disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 ease-apple',
  ghost:
    'inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm bg-transparent text-primary hover:bg-primary/[0.10] disabled:bg-transparent disabled:text-slate-400 disabled:cursor-not-allowed transition-all duration-150 ease-apple',
  tonal:
    'inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm bg-primary/[0.12] text-primary hover:bg-primary/[0.20] disabled:bg-surface-variant disabled:text-text-disabled disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 ease-apple',
  outlined:
    'inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm bg-transparent text-primary border border-border hover:bg-primary/[0.08] disabled:border-border disabled:text-text-disabled disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 ease-apple',
  danger:
    'inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm bg-error text-white hover:bg-error-hover active:scale-[0.97] disabled:bg-surface-variant disabled:text-text-disabled disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 ease-apple',
  icon:
    'inline-flex items-center justify-center w-8 h-8 rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 ease-apple text-base leading-none',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${variantClasses[variant]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
