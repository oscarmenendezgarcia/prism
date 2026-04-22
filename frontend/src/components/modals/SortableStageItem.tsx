/**
 * A single draggable pipeline-stage row in the Run Pipeline modal.
 *
 * Uses `useSortable({ id })` from @dnd-kit/sortable to provide pointer-drag
 * and keyboard-drag affordances.  The drag handle is the only focusable
 * element for keyboard activation (the rest of the row is draggable via
 * PointerSensor).
 *
 * T-005: add SortableStageItem component.
 */

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PipelineStage } from '@/types';

const STAGE_ICON: Record<string, string> = {
  'senior-architect': 'architecture',
  'ux-api-designer':  'palette',
  'developer-agent':  'code',
  'qa-engineer-e2e':  'bug_report',
};

const STAGE_COLOR_CLASS: Record<string, string> = {
  'senior-architect': 'text-agent-architect',
  'ux-api-designer':  'text-agent-ux',
  'developer-agent':  'text-agent-dev',
  'qa-engineer-e2e':  'text-agent-qa',
};

const STAGE_BG_CLASS: Record<string, string> = {
  'senior-architect': 'bg-agent-architect/10',
  'ux-api-designer':  'bg-agent-ux/10',
  'developer-agent':  'bg-agent-dev/10',
  'qa-engineer-e2e':  'bg-agent-qa/10',
};

export interface SortableStageItemProps {
  /** Stable row instance key — unique even when the same agent appears twice. */
  id: string;
  /** 1-based display index for the position label. */
  index: number;
  stage: PipelineStage;
  displayName: string;
  checkpointActive: boolean;
  /** When false, hides the "Pause before this stage" checkbox (orchestrator mode). */
  showCheckpoint: boolean;
  onRemove: () => void;
  onToggleCheckpoint: () => void;
}

export function SortableStageItem({
  id,
  index,
  stage,
  displayName,
  checkpointActive,
  showCheckpoint,
  onRemove,
  onToggleCheckpoint,
}: SortableStageItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const colorClass = STAGE_COLOR_CLASS[stage] ?? 'text-primary';
  const bgClass    = STAGE_BG_CLASS[stage]    ?? 'bg-primary/10';

  return (
    <li
      ref={setNodeRef}
      // dnd-kit-required: transform and transition must be applied as inline
      // styles — Tailwind cannot dynamically generate arbitrary pixel values
      // for the 3D matrix transform produced by @dnd-kit at runtime.
      style={{ transform: CSS.Transform.toString(transform), transition }} // lint-ok: required by @dnd-kit per ADR-1 §Constraints
      data-dnd-item-key={id}
      className={`flex flex-col gap-1.5 bg-surface-elevated border border-border rounded-lg px-3 py-2.5 transition-opacity ${isDragging ? 'opacity-50' : 'opacity-100'}`}
      // BUG-003: aria-roledescription="sortable" must NOT be on the <li>.
      // The <li> announces as "listitem" to screen readers — that is correct.
      // The drag handle <button> below receives {…attributes} from useSortable
      // which already includes aria-roledescription="sortable" on that element.
      // Putting it on both causes double-announcement noise in VoiceOver/NVDA.
    >
      <div className="flex items-center gap-2.5">
        {/* ── Drag handle ── */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${displayName}`}
          data-dnd-handle-key={id}
          className={[
            'flex items-center justify-center flex-shrink-0',
            'text-text-secondary hover:text-text-primary',
            'rounded',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
            isDragging ? 'cursor-grabbing' : 'cursor-grab',
          ].join(' ')}
        >
          <span className="material-symbols-outlined text-xl leading-none" aria-hidden="true">
            drag_indicator
          </span>
        </button>

        {/* ── Agent chip ── */}
        <div className={`flex h-7 w-7 items-center justify-center rounded-md flex-shrink-0 ${bgClass}`}>
          <span className={`material-symbols-outlined text-sm leading-none ${colorClass}`} aria-hidden="true">
            {STAGE_ICON[stage] ?? 'smart_toy'}
          </span>
        </div>

        {/* ── Position index ── */}
        <span className="text-[10px] text-text-disabled font-mono flex-shrink-0">{index}</span>

        {/* ── Agent display name ── */}
        <span className={`text-sm font-medium flex-1 truncate ${colorClass}`}>
          {displayName}
        </span>

        {/* ── Remove button ── */}
        <button
          type="button"
          onClick={onRemove}
          disabled={isDragging}
          aria-label="Remove stage"
          className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-error hover:bg-error/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0 text-sm"
        >
          ✕
        </button>
      </div>

      {/* ── "Pause before this stage" checkpoint ── */}
      {showCheckpoint && (
        <label className="flex items-center gap-2 cursor-pointer pl-6">
          <input
            type="checkbox"
            checked={checkpointActive}
            onChange={onToggleCheckpoint}
            aria-label={`Pause before stage ${index}: ${displayName}`}
            className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
          />
          <span className="text-[11px] text-text-secondary select-none">
            Pause before this stage
          </span>
          {checkpointActive && (
            <span
              className="material-symbols-outlined text-xs text-warning leading-none"
              aria-hidden="true"
              title="Pipeline will pause"
            >
              pause_circle
            </span>
          )}
        </label>
      )}
    </li>
  );
}
