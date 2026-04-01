/**
 * Task detail & edit side panel.
 *
 * Slides in from the right when detailTask is non-null in the store.
 * Renders editable fields for title, type, assigned, and description.
 * Auto-saves title and assigned on blur; type on change; description
 * only on explicit button press.
 *
 * ADR-1 (task-detail-edit):
 *  - App-level render prevents z-index stacking issues with column containers.
 *  - Reuses existing PUT endpoint via store.updateTask — no new backend code.
 *  - ARIA role="dialog" with focus trap and focus-return on close.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAppStore, useActiveRun } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';
import { formatTimestamp } from '@/utils/formatTimestamp';
import type { Column } from '@/types';

// ---------------------------------------------------------------------------
// Copy-to-clipboard helper
// ---------------------------------------------------------------------------

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for non-HTTPS or older browsers.
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMN_LABELS: Record<Column, string> = {
  'todo': 'Todo',
  'in-progress': 'In Progress',
  'done': 'Done',
};

/** Find which column a task lives in from the board tasks. */
function findTaskColumn(
  tasks: Record<Column, { id: string }[]>,
  taskId: string,
): Column | undefined {
  const columns: Column[] = ['todo', 'in-progress', 'done'];
  return columns.find((col) =>
    tasks[col].some((t) => t.id === taskId),
  );
}

// ---------------------------------------------------------------------------
// Focus trap hook
// ---------------------------------------------------------------------------

/**
 * Traps keyboard focus within a container element while the panel is open.
 * Cycles through focusable elements on Tab / Shift+Tab.
 */
function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return;

    const FOCUSABLE = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !containerRef.current) return;

      const focusable = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, containerRef]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Task detail panel — no props required.
 * Reads detailTask from the store; renders null when the panel is closed.
 */
export function TaskDetailPanel(): React.ReactElement | null {
  const detailTask       = useAppStore((s) => s.detailTask);
  const closeDetailPanel = useAppStore((s) => s.closeDetailPanel);
  const updateTask       = useAppStore((s) => s.updateTask);
  const isMutating       = useAppStore((s) => s.isMutating);
  const tasks            = useAppStore((s) => s.tasks);
  const showToast        = useAppStore((s) => s.showToast);
  const activeRun        = useActiveRun();

  // ── Local field state ────────────────────────────────────────────────────

  const [localTitle, setLocalTitle]             = useState('');
  const [localAssigned, setLocalAssigned]       = useState('');
  const [localDescription, setLocalDescription] = useState('');
  const [localType, setLocalType]               = useState<'feature' | 'bug' | 'tech-debt' | 'chore'>('chore');
  const [isCopied, setIsCopied]                 = useState(false);

  // Track initial values to detect actual changes on blur.
  const savedTitle       = useRef('');
  const savedAssigned    = useRef('');

  // ── Refs for focus management ────────────────────────────────────────────

  const panelRef         = useRef<HTMLDivElement | null>(null);
  const titleInputRef    = useRef<HTMLInputElement | null>(null);
  /** Element that triggered the panel open — focus returns here on close. */
  const triggerRef       = useRef<Element | null>(null);

  // ── Sync local state when detailTask changes ─────────────────────────────

  useEffect(() => {
    if (!detailTask) return;

    setLocalTitle(detailTask.title);
    setLocalAssigned(detailTask.assigned ?? '');
    setLocalDescription(detailTask.description ?? '');
    setLocalType(detailTask.type);

    savedTitle.current    = detailTask.title;
    savedAssigned.current = detailTask.assigned ?? '';

    // Capture the currently focused element as the trigger before the panel
    // steals focus.
    triggerRef.current = document.activeElement;

    // Defer focus so the panel has time to mount and become visible.
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });
  }, [detailTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only re-sync when a different task is opened, not on every field update.

  // ── Return focus on close ────────────────────────────────────────────────

  const prevDetailTask = useRef(detailTask);
  useEffect(() => {
    if (prevDetailTask.current !== null && detailTask === null) {
      // Panel just closed — return focus to trigger.
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    }
    prevDetailTask.current = detailTask;
  }, [detailTask]);

  // ── Focus trap ───────────────────────────────────────────────────────────

  useFocusTrap(panelRef, detailTask !== null);

  // ── Escape key handler ───────────────────────────────────────────────────

  useEffect(() => {
    if (!detailTask) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDetailPanel();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [detailTask, closeDetailPanel]);

  // ── Save helpers ─────────────────────────────────────────────────────────

  const isReadOnly = isMutating || (activeRun !== null && activeRun.taskId === detailTask?.id);

  const handleTitleBlur = useCallback(() => {
    const trimmed = localTitle.trim();
    if (!detailTask || trimmed === savedTitle.current) return;
    if (!trimmed) {
      // Revert empty title to last saved value (never send blank title).
      setLocalTitle(savedTitle.current);
      return;
    }
    savedTitle.current = trimmed;
    updateTask(detailTask.id, { title: trimmed });
  }, [detailTask, localTitle, updateTask]);

  const handleAssignedBlur = useCallback(() => {
    if (!detailTask) return;
    const trimmed = localAssigned.trim();
    if (trimmed === savedAssigned.current) return;
    savedAssigned.current = trimmed;
    updateTask(detailTask.id, { assigned: trimmed });
  }, [detailTask, localAssigned, updateTask]);

  const handleTypeChange = useCallback(
    (newType: 'feature' | 'bug' | 'tech-debt' | 'chore') => {
      if (!detailTask || newType === localType) return;
      setLocalType(newType);
      updateTask(detailTask.id, { type: newType });
    },
    [detailTask, localType, updateTask],
  );

  const handleSaveDescription = useCallback(() => {
    if (!detailTask) return;
    updateTask(detailTask.id, { description: localDescription.trim() });
  }, [detailTask, localDescription, updateTask]);

  const handleCopyId = useCallback(async () => {
    if (!detailTask) return;
    try {
      await copyToClipboard(detailTask.id);
      setIsCopied(true);
      showToast('Task ID copied to clipboard', 'success');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('Failed to copy ID', 'error');
    }
  }, [detailTask, showToast]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (!detailTask) return null;

  const column = findTaskColumn(tasks, detailTask.id);
  const columnLabel = column ? COLUMN_LABELS[column] : '';

  /** Short ID chip — last 7 chars for display. */
  const shortId = `#${detailTask.id.slice(-7)}`;

  const isActiveRun = activeRun?.taskId === detailTask.id;
  const fieldDisabled = isReadOnly;

  return (
    <>
      {/* Backdrop — z-[105] to sit above the sticky header (z-[100]) */}
      <div
        className="fixed inset-0 z-[105] bg-black/35"
        aria-hidden="true"
        onClick={closeDetailPanel}
      />

      {/* Panel — z-[110] to sit above the backdrop and header */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Task detail"
        className="fixed inset-y-0 right-0 z-[110] w-full sm:w-[380px] flex flex-col bg-surface border-l border-border shadow-xl animate-slide-in-right"
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono text-text-secondary bg-surface-variant px-1.5 py-0.5 rounded-sm flex-shrink-0">
              {shortId}
            </span>
            {column && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium leading-none uppercase tracking-wide flex-shrink-0 ${
                  column === 'done'
                    ? 'bg-[rgba(36,138,61,0.12)] dark:bg-[rgba(48,209,88,0.14)] text-badge-done-text'
                    : column === 'in-progress'
                    ? 'bg-[rgba(10,132,255,0.12)] dark:bg-[rgba(10,132,255,0.14)] text-badge-research-text'
                    : 'bg-[rgba(232,104,0,0.12)] dark:bg-[rgba(255,159,10,0.14)] text-badge-task-text'
                }`}
              >
                {columnLabel}
              </span>
            )}
          </div>
          <button
            onClick={closeDetailPanel}
            aria-label="Close task detail"
            className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary transition-colors duration-150 flex-shrink-0"
          >
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">

          {/* Active run warning banner */}
          {isActiveRun && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-warning/10 border border-warning/30">
              <span className="material-symbols-outlined text-warning text-base leading-none" aria-hidden="true">
                warning
              </span>
              <p className="text-xs text-warning leading-snug">
                Agent pipeline is running — editing disabled
              </p>
            </div>
          )}

          {/* ── ID ──────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              ID
            </span>
            <div className="flex items-center gap-2">
              <span className="flex-1 font-mono text-xs text-text-secondary bg-surface-elevated border border-border rounded-md px-3 py-2 select-all overflow-x-auto whitespace-nowrap">
                {detailTask.id}
              </span>
              <button
                type="button"
                onClick={handleCopyId}
                aria-label="Copy task ID"
                title="Copy task ID"
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary transition-colors duration-150"
              >
                <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
                  {isCopied ? 'check' : 'content_copy'}
                </span>
              </button>
            </div>
          </div>

          {/* ── Title ───────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="detail-title" className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              Title
            </label>
            <input
              id="detail-title"
              ref={titleInputRef}
              type="text"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={handleTitleBlur}
              disabled={fieldDisabled}
              aria-disabled={fieldDisabled}
              className="w-full px-3 py-2 rounded-md bg-surface-elevated border border-border text-sm text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
              placeholder="Task title"
            />
          </div>

          {/* ── Type ────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              Type
            </span>
            <div
              role="group"
              aria-label="Task type"
              className="flex rounded-md overflow-hidden border border-border"
            >
              {(['feature', 'bug', 'tech-debt', 'chore'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={localType === t}
                  onClick={() => handleTypeChange(t)}
                  disabled={fieldDisabled}
                  aria-disabled={fieldDisabled}
                  className={`flex-1 py-1.5 text-xs font-medium capitalize transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed ${
                    localType === t
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-elevated text-text-secondary hover:bg-surface-variant'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* ── Assigned ────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="detail-assigned" className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              Assigned
            </label>
            <input
              id="detail-assigned"
              type="text"
              value={localAssigned}
              onChange={(e) => setLocalAssigned(e.target.value)}
              onBlur={handleAssignedBlur}
              disabled={fieldDisabled}
              aria-disabled={fieldDisabled}
              className="w-full px-3 py-2 rounded-md bg-surface-elevated border border-border text-sm text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
              placeholder="Assign to someone..."
            />
          </div>

          {/* ── Description ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="detail-description" className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              Description
            </label>
            <textarea
              id="detail-description"
              value={localDescription}
              onChange={(e) => setLocalDescription(e.target.value)}
              disabled={fieldDisabled}
              aria-disabled={fieldDisabled}
              rows={6}
              className="w-full px-3 py-2 rounded-md bg-surface-elevated border border-border text-sm text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed resize-none transition-colors duration-150"
              placeholder="Add a description..."
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={handleSaveDescription}
                disabled={fieldDisabled}
                className="text-xs px-3 py-1.5"
              >
                {isMutating ? (
                  <>
                    <span className="material-symbols-outlined text-sm leading-none animate-spin" aria-hidden="true">
                      progress_activity
                    </span>
                    Saving...
                  </>
                ) : (
                  'Save description'
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Footer — read-only metadata ──────────────────────────────── */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-border flex flex-col gap-1">
          <span className="text-xs text-text-disabled">
            Created: {formatTimestamp(detailTask.createdAt)}
          </span>
          <span className="text-xs text-text-disabled">
            Updated: {formatTimestamp(detailTask.updatedAt)}
          </span>
        </div>
      </div>
    </>
  );
}
