/**
 * ScopeSelector — segmented Global | Space control.
 *
 * Space option is disabled when no active space is provided.
 * Accessibility: role="radiogroup" with aria-checked on each option.
 */

import React from 'react';
import { Tooltip } from '@/components/shared/Tooltip';

export type Scope = 'global' | 'space';

interface ScopeSelectorProps {
  scope:         Scope;
  spaceName?:    string; // active space name; undefined → Space option is disabled
  onChange:      (scope: Scope) => void;
}

export function ScopeSelector({ scope, spaceName, onChange }: ScopeSelectorProps) {
  const spaceLabel = spaceName ? `Space · ${spaceName}` : 'Space';
  const spaceDisabled = !spaceName;

  return (
    <div
      role="radiogroup"
      aria-label="Model routing scope"
      className="inline-flex gap-[3px] bg-surface border border-border rounded-sm p-[3px]"
    >
      <ScopeButton
        label="Global"
        active={scope === 'global'}
        onClick={() => onChange('global')}
      />
      <ScopeButton
        label={spaceLabel}
        active={scope === 'space'}
        disabled={spaceDisabled}
        onClick={() => !spaceDisabled && onChange('space')}
        title={spaceDisabled ? 'Open a space to edit space-level routing' : undefined}
      />
    </div>
  );
}

interface ScopeButtonProps {
  label:    string;
  active:   boolean;
  disabled?: boolean;
  onClick:  () => void;
  title?:   string;
}

function ScopeButton({ label, active, disabled, onClick, title }: ScopeButtonProps) {
  const button = (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      disabled={disabled}
      title={title}
      onClick={onClick}
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
      {label}
    </button>
  );

  // A native title tooltip needs a long hover and doesn't reach keyboard/touch users —
  // the shared Tooltip surfaces the same explanation reliably for everyone.
  if (disabled && title) {
    return <Tooltip label={title}>{button}</Tooltip>;
  }
  return button;
}
