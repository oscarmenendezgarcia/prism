/**
 * Space settings: the command to run when an agent finishes a task. Saved with the
 * rest of the space by the modal's Save button.
 */

import React from 'react';

const inputClass = 'w-full px-3 py-2 rounded-lg bg-surface-variant border border-border text-sm text-text-primary placeholder:text-text-disabled focus:outline-hidden focus:border-primary transition-colors duration-fast';

export interface HookDraft {
  name: string;
  command: string;
}

interface SpaceHookSectionProps {
  value: HookDraft;
  onChange: (value: HookDraft) => void;
}

export function SpaceHookSection({ value, onChange }: SpaceHookSectionProps) {
  return (
    <div className="flex flex-col gap-2" data-testid="space-hook-section">
      <div>
        <p className="text-sm font-medium text-text-primary">When the agent finishes</p>
        <p className="text-xs text-text-secondary mt-0.5">
          Runs in the task's worktree. If it fails, the card stays open with its output.
        </p>
      </div>
      <input
        type="text"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        maxLength={60}
        placeholder="Name"
        aria-label="Check name"
        className={inputClass}
      />
      <input
        type="text"
        value={value.command}
        onChange={(e) => onChange({ ...value, command: e.target.value })}
        maxLength={2000}
        placeholder="npm test"
        aria-label="Command"
        className={`${inputClass} font-mono`}
      />
    </div>
  );
}
