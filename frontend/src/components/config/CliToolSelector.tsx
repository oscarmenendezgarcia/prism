/**
 * CliToolSelector — segmented control to pick the CLI tool that runs a stage.
 *
 * MODEL-2 wired `opencode` end-to-end in the backend (binary resolution +
 * provider/model routing for local/self-hosted models, e.g. a GB10/DGX box).
 * This control exposes that choice per agent in the Proposal D expanded card.
 *
 * `custom` is a reserved backend value (spawning not implemented) and is not
 * offered here.
 *
 * Accessibility: radiogroup semantics; each option is a radio with aria-checked.
 */

import React from 'react';
import type { ModelCliTool } from '@/types';

const OPTIONS: ReadonlyArray<{ value: ModelCliTool; label: string }> = [
  { value: 'claude',   label: 'Claude' },
  { value: 'opencode', label: 'opencode' },
];

interface CliToolSelectorProps {
  value: ModelCliTool;
  onChange: (value: ModelCliTool) => void;
  /** Used in aria-labels so screen readers know which agent this controls. */
  agentLabel: string;
}

export function CliToolSelector({ value, onChange, agentLabel }: CliToolSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label={`CLI tool for ${agentLabel}`}
      className="inline-flex gap-0.5 bg-surface border border-border rounded-[9px] p-[3px]"
    >
      {OPTIONS.map(({ value: opt, label }) => {
        const isActive = opt === value;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt)}
            className={[
              'px-3 py-1 text-[11.5px] font-semibold font-mono rounded-md border-0 select-none',
              'transition-colors duration-fast active:scale-[0.97]',
              isActive
                ? 'bg-primary-container text-primary'
                : 'bg-transparent text-text-secondary hover:text-text-primary',
            ].join(' ')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
