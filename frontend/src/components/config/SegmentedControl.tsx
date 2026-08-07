/**
 * SegmentedControl — generic segmented radio-group.
 *
 * Shared by ScopeSelector and CliToolSelector, which differed only in their
 * option list and label/disabled logic. Options may be individually disabled
 * (with an optional tooltip explaining why), matching ScopeSelector's Space
 * option behavior.
 *
 * Accessibility: role="radiogroup" with aria-checked on each option.
 */

import React from 'react';
import { Tooltip } from '@/components/shared/Tooltip';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  /** Shown via Tooltip when the option is disabled. */
  disabledTitle?: string;
  /** When disabled, clicking opens this install link in a new tab. */
  disabledHref?: string;
}

interface SegmentedControlProps<T extends string> {
  ariaLabel: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  ariaLabel, options, value, onChange,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex gap-[3px] bg-surface border border-border rounded-sm p-[3px]"
    >
      {options.map((opt) => (
        <SegmentedButton
          key={opt.value}
          active={opt.value === value}
          disabled={opt.disabled}
          disabledTitle={opt.disabled ? opt.disabledTitle : undefined}
          disabledHref={opt.disabled ? opt.disabledHref : undefined}
          onSelect={() => onChange(opt.value)}
        >
          {opt.label}
        </SegmentedButton>
      ))}
    </div>
  );
}

interface SegmentedButtonProps {
  active:         boolean;
  disabled?:      boolean;
  disabledTitle?: string;
  /** Install link opened in a new tab when a disabled option is clicked. */
  disabledHref?:  string;
  onSelect:       () => void;
  children:       React.ReactNode;
}

function SegmentedButton({ active, disabled, disabledTitle, disabledHref, onSelect, children }: SegmentedButtonProps) {
  // A disabled option stays clickable when it carries an install link (so the
  // link can open), but is aria-disabled and ignores selection. Options disabled
  // without a link keep the native `disabled` (e.g. ScopeSelector's Space option).
  const handleClick = () => {
    if (disabled) {
      if (disabledHref) window.open(disabledHref, '_blank', 'noopener,noreferrer');
      return;
    }
    onSelect();
  };

  const button = (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      disabled={disabled && !disabledHref}
      title={disabled ? disabledTitle : undefined}
      onClick={handleClick}
      className={[
        'px-3 py-[5px] text-[12px] font-semibold rounded-md transition-all duration-fast',
        'whitespace-nowrap',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50',
        active
          ? 'bg-primary-container text-primary'
          : disabled
            ? 'text-text-secondary/40 cursor-not-allowed'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant',
      ].join(' ')}
    >
      {children}
    </button>
  );

  // A native title tooltip needs a long hover and doesn't reach keyboard/touch users —
  // the shared Tooltip surfaces the same explanation reliably for everyone.
  if (disabled && disabledTitle) {
    return <Tooltip label={disabledTitle}>{button}</Tooltip>;
  }
  return button;
}
