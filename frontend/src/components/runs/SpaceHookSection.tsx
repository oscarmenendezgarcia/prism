/**
 * Space settings: what follows the agent when it finishes a task. Saved with the rest of
 * the space by the modal's Save button.
 */

import React from 'react';
import type { SpaceHooks, Status } from '@/types';

export const EMPTY_SPACE_HOOKS: SpaceHooks = { checkCommand: null, autoPr: false };

/** A space's settings. Anything else in the field, such as an older format, counts as empty. */
export function readSpaceHooks(hooks: unknown): SpaceHooks {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return EMPTY_SPACE_HOOKS;
  const { checkCommand, autoPr } = hooks as Partial<SpaceHooks>;
  return {
    checkCommand: typeof checkCommand === 'string' ? checkCommand : null,
    autoPr: autoPr === true,
  };
}

interface SpaceHookSectionProps {
  hooks: SpaceHooks;
  onChange: (hooks: SpaceHooks) => void;
  /** The saved statuses an agent's finished work can move to. */
  statuses?: Array<Pick<Status, 'id' | 'name'>>;
  /** Statuses in the form that cannot be chosen until they are saved. */
  hasUnsavedStatuses?: boolean;
  finishStatus?: string;
  onFinishStatusChange?: (statusId: string) => void;
}

export function SpaceHookSection({ hooks, onChange, statuses, hasUnsavedStatuses, finishStatus, onFinishStatusChange }: SpaceHookSectionProps) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-3" data-testid="hook-section">
      <legend className="sr-only">When an agent finishes</legend>
      <label className="flex flex-col gap-1 text-xs text-text-secondary">
        Check command
        <input
          type="text"
          value={hooks.checkCommand ?? ''}
          onChange={(e) => onChange({ ...hooks, checkCommand: e.target.value })}
          placeholder="npm test"
          className="w-full px-3 py-2 rounded-lg bg-surface-variant border border-border text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-hidden focus:border-primary transition-colors duration-fast"
        />
        <span className="text-text-disabled">Runs in the task's worktree when the agent finishes. It must pass before the task moves on.</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
        <input
          type="checkbox"
          checked={hooks.autoPr}
          onChange={(e) => onChange({ ...hooks, autoPr: e.target.checked })}
          className="accent-primary"
        />
        Open a pull request automatically
      </label>
      {statuses && statuses.length > 0 && (
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          When an agent finishes, move to
          <select
            value={finishStatus ?? ''}
            onChange={(e) => onFinishStatusChange?.(e.target.value)}
            data-testid="finish-status"
            className="w-full px-3 py-2 rounded-lg bg-surface-variant border border-border text-sm text-text-primary focus:outline-hidden focus:border-primary transition-colors duration-fast"
          >
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {hasUnsavedStatuses && <span className="text-text-disabled">New statuses can be chosen after saving.</span>}
        </label>
      )}
    </fieldset>
  );
}
