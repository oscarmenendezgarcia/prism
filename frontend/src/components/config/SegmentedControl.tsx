/**
 * SegmentedControl — generic segmented radio-group.
 *
 * Shared by ScopeSelector and CliToolSelector, which differed only in their
 * option list and label/disabled logic. Options may be individually disabled
 * (with an optional tooltip explaining why), matching ScopeSelector's Space
 * option behavior.
 *
 * Accessibility: role="radiogroup" with a roving tabindex and arrow-key
 * navigation (only the selected radio is tabbable; Arrow keys move selection).
 * A disabled option that carries an install link (disabledHref) is rendered as
 * a separate external-link affordance, not a broken radio — an uninstalled
 * harness is a link, not a dead control.
 */

import React, { useRef } from 'react';
import { Tooltip } from '@/components/shared/Tooltip';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  /** Shown via Tooltip when the option is disabled. */
  disabledTitle?: string;
  /** When disabled, the option becomes an external link opened on click. */
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
  const groupRef = useRef<HTMLDivElement | null>(null);

  // Arrow-key navigation across the radio options (roving tabindex).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const radios = Array.from(
      groupRef.current?.querySelectorAll('[role="radio"]') ?? [],
    ).filter((el) => !(el as HTMLButtonElement).disabled) as HTMLElement[];
    if (radios.length === 0) return;
    const idx = radios.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    e.preventDefault();
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const next = radios[(idx + (forward ? 1 : -1) + radios.length) % radios.length];
    next.focus();
    onChange(next.getAttribute('data-value') as T);
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      // rounded-sm track (8px) with a 3px inset: segments use rounded-xs so the
      // selected pill fits inside the track corners instead of bulging past them.
      className="inline-flex gap-[3px] bg-surface-sunken border border-border rounded-sm p-[3px]"
    >
      {options.map((opt) => (
        <SegmentedButton
          key={opt.value}
          value={opt.value}
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
  value:          string;
  active:         boolean;
  disabled?:      boolean;
  disabledTitle?: string;
  /** Install link opened in a new tab when a disabled option is clicked. */
  disabledHref?:  string;
  onSelect:       () => void;
  children:       React.ReactNode;
}

function SegmentedButton({
  value, active, disabled, disabledTitle, disabledHref, onSelect, children,
}: SegmentedButtonProps) {
  // Unavailable harness with an install link → an external-link affordance, not
  // a dead radio: normal-contrast text, link cursor, external-open cue.
  if (disabled && disabledHref) {
    return (
      <button
        type="button"
        role="link"
        title={disabledTitle}
        onClick={() => window.open(disabledHref, '_blank', 'noopener,noreferrer')}
        className={[
          'px-3 py-[5px] text-[12px] font-semibold rounded-xs whitespace-nowrap',
          'transition-all duration-fast',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50',
          'text-text-secondary hover:text-primary hover:underline underline-offset-2 cursor-pointer',
        ].join(' ')}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <span className="material-symbols-outlined text-[12px] leading-none" aria-hidden="true">
            open_in_new
          </span>
        </span>
      </button>
    );
  }

  const button = (
    <button
      type="button"
      role="radio"
      data-value={value}
      aria-checked={active}
      aria-disabled={disabled}
      disabled={disabled}
      tabIndex={disabled ? undefined : active ? 0 : -1}
      title={disabled ? disabledTitle : undefined}
      onClick={() => !disabled && onSelect()}
      className={[
        'px-3 py-[5px] text-[12px] font-semibold rounded-xs whitespace-nowrap',
        'transition-all duration-fast',
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
  // the shared Tooltip surfaces the same explanation (hover AND focus-within).
  if (disabled && disabledTitle) {
    return <Tooltip label={disabledTitle}>{button}</Tooltip>;
  }
  return button;
}
