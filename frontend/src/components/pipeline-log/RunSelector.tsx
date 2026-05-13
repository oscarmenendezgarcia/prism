/**
 * RunSelector — dropdown in the PipelineLogPanel header to switch between
 * multiple concurrent or sequential pipeline runs.
 *
 * Rendered only when pipelineStates contains 2 or more runs.
 * Exposes a custom listbox dropdown (role="listbox") with full keyboard
 * support: Arrow keys navigate, Enter/Space selects, Escape closes.
 *
 * Design spec: wireframes.md S-02, DESIGN-NOTES.md §2 & §8.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { PipelineState } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the first 8 chars of a UUID as a short display label. */
function shortRunId(runId: string): string {
  return `run-${runId.slice(0, 8)}`;
}

/** Returns a display label for the run option button. */
function runStatusLabel(status: PipelineState['status']): string {
  switch (status) {
    case 'running':     return 'running';
    case 'completed':   return 'completed';
    case 'aborted':     return 'aborted';
    case 'interrupted': return 'interrupted';
    case 'paused':      return 'paused';
    case 'blocked':     return 'blocked';
    default:            return status;
  }
}

/** Returns a single-char status icon paired with an accessible text label. */
function statusIconChar(status: PipelineState['status']): { icon: string; label: string } {
  switch (status) {
    case 'running':     return { icon: '●', label: 'running'     };
    case 'completed':   return { icon: '✓', label: 'completed'   };
    case 'aborted':     return { icon: '✕', label: 'aborted'     };
    case 'interrupted': return { icon: '✕', label: 'interrupted' };
    case 'paused':      return { icon: '⏸', label: 'paused'     };
    case 'blocked':     return { icon: '⏸', label: 'blocked'    };
    default:            return { icon: '○', label: status        };
  }
}

/** CSS class for the status icon based on pipeline status. */
function statusIconClass(status: PipelineState['status']): string {
  switch (status) {
    case 'running':     return 'text-primary';
    case 'completed':   return 'text-success';
    case 'aborted':
    case 'interrupted': return 'text-error';
    case 'paused':
    case 'blocked':     return 'text-warning';
    default:            return 'text-text-disabled';
  }
}

/** Format an ISO timestamp to HH:MM. */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RunSelectorEntry {
  /** Dict key in pipelineStates (usually the runId, may be '__pending__'). */
  key: string;
  pipelineState: PipelineState;
}

interface RunSelectorProps {
  /** All runs sorted by startedAt descending (most recent first). */
  runs: RunSelectorEntry[];
  /** Currently selected runId (or null if auto-selected). */
  selectedRunId: string | null;
  /** Called when the user selects a different run. */
  onSelect: (runId: string) => void;
}

export function RunSelector({ runs, selectedRunId, onSelect }: RunSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef   = useRef<HTMLUListElement>(null);

  // The run ID that is currently "shown" — either the explicit selection or the
  // first run (most recent) when no explicit selection has been made.
  const displayRunId = selectedRunId ?? runs[0]?.key ?? null;
  const displayEntry = runs.find((r) => r.key === displayRunId) ?? runs[0] ?? null;

  const openDropdown = useCallback(() => {
    const idx = runs.findIndex((r) => r.key === displayRunId);
    setFocusIndex(idx >= 0 ? idx : 0);
    setIsOpen(true);
  }, [runs, displayRunId]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  const selectRun = useCallback((runKey: string) => {
    onSelect(runKey);
    closeDropdown();
  }, [onSelect, closeDropdown]);

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || listRef.current?.contains(target)) return;
      closeDropdown();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, closeDropdown]);

  // Focus the highlighted option when dropdown opens or focus index changes.
  useEffect(() => {
    if (!isOpen) return;
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    items?.[focusIndex]?.focus();
  }, [isOpen, focusIndex]);

  const handleButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openDropdown();
    }
  };

  const handleOptionKeyDown = (e: React.KeyboardEvent<HTMLLIElement>, idx: number) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIndex(Math.min(idx + 1, runs.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIndex(Math.max(idx - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectRun(runs[idx].key);
        break;
      case 'Escape':
        e.preventDefault();
        closeDropdown();
        break;
      case 'Tab':
        closeDropdown();
        break;
    }
  };

  if (!displayEntry) return null;

  const { icon: buttonIcon, label: buttonIconLabel } = statusIconChar(displayEntry.pipelineState.status);

  return (
    <div className="relative flex-shrink-0">
      {/* Trigger button */}
      <button
        ref={buttonRef}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="run-selector-list"
        aria-label={`Select pipeline run. Current: ${shortRunId(displayEntry.key)}`}
        onClick={() => (isOpen ? closeDropdown() : openDropdown())}
        onKeyDown={handleButtonKeyDown}
        className="
          flex items-center gap-1.5 px-2 py-1 min-h-[28px] rounded-md
          text-xs font-mono text-text-secondary
          bg-surface-variant border border-border
          hover:border-primary/50 hover:text-text-primary
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary
          transition-colors duration-150
        "
      >
        <span aria-label={buttonIconLabel} className={`text-[10px] leading-none ${statusIconClass(displayEntry.pipelineState.status)}`}>
          {buttonIcon}
        </span>
        <span className="max-w-[80px] truncate hidden sm:inline">
          {shortRunId(displayEntry.key)}
        </span>
        <span className="max-w-[60px] truncate sm:hidden">
          {shortRunId(displayEntry.key).slice(0, 10)}
        </span>
        <span
          className={`material-symbols-outlined text-[12px] leading-none transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          expand_more
        </span>
      </button>

      {/* Dropdown list */}
      {isOpen && (
        <ul
          ref={listRef}
          id="run-selector-list"
          role="listbox"
          aria-label="Pipeline runs"
          aria-activedescendant={`run-option-${focusIndex}`}
          className="
            absolute top-full left-0 mt-1 z-50 min-w-[220px]
            max-h-[200px] overflow-y-auto
            bg-surface border border-border rounded-lg shadow-lg
            py-1
          "
        >
          {runs.map((entry, idx) => {
            const ps = entry.pipelineState;
            const isSelected = entry.key === displayRunId;
            const { icon, label: iconLabel } = statusIconChar(ps.status);
            const agentId = ps.stages[ps.currentStageIndex] ?? ps.stages[0];
            const stageLabel = `Stage ${ps.currentStageIndex + 1}/${ps.stages.length}`;
            const timeLabel  = formatTime(ps.startedAt);
            const statusText = runStatusLabel(ps.status);

            // Accessible label for screen readers.
            const ariaLabel = [
              shortRunId(entry.key),
              stageLabel,
              agentId,
              statusText,
              timeLabel,
            ].filter(Boolean).join(', ');

            return (
              <li
                key={entry.key}
                id={`run-option-${idx}`}
                role="option"
                aria-selected={isSelected}
                aria-label={ariaLabel}
                tabIndex={-1}
                onClick={() => selectRun(entry.key)}
                onKeyDown={(e) => handleOptionKeyDown(e, idx)}
                className={`
                  flex items-start gap-2 px-3 py-2 cursor-pointer
                  text-xs leading-tight
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary
                  transition-colors duration-100
                  ${isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'}
                `}
              >
                {/* Status icon column */}
                <span
                  aria-label={iconLabel}
                  className={`mt-0.5 w-4 text-center text-[11px] leading-none flex-shrink-0 ${isSelected ? 'text-primary' : statusIconClass(ps.status)}`}
                >
                  {isSelected ? '✓' : icon}
                </span>

                {/* Run info column */}
                <div className="flex flex-col gap-0.5 min-w-0">
                  {/* Run label + stage */}
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-mono font-semibold text-[11px]">
                      {shortRunId(entry.key)}
                    </span>
                    <span className="text-text-disabled text-[10px] hidden sm:inline">
                      — {stageLabel}
                    </span>
                    {agentId && (
                      <span className="text-text-disabled text-[10px] hidden sm:inline">
                        ({agentId})
                      </span>
                    )}
                  </div>
                  {/* Status + time */}
                  <div className="flex items-center gap-1.5 text-[10px] text-text-disabled">
                    <span className={statusIconClass(ps.status)}>{statusText}</span>
                    {timeLabel && (
                      <>
                        <span>·</span>
                        <span>{timeLabel}</span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
