/**
 * Task detail & edit panel — responsive.
 *
 * Desktop (≥768px): centered modal with a 2-column grid layout.
 *   Left column (55%): fields (title, type, assigned, description, pipeline,
 *   attachments) + timestamps. Right column (45%): threaded comment section
 *   with independent scroll.
 *
 * Mobile (<768px): slide-in panel from the right (original behavior).
 *   Single-column vertical scroll for all fields + comments.
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
import { useAppStore, useActiveRun, useAvailableAgents } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';
import { CommentsSection } from '@/components/board/CommentsSection';
import { formatTimestamp } from '@/utils/formatTimestamp';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { Column, Comment } from '@/types';

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
// Pipeline field editor (T-009)
// ---------------------------------------------------------------------------

interface PipelineFieldEditorProps {
  /** Current pipeline value from the task (undefined = use space default). */
  pipeline: string[] | undefined;
  /** All known agent IDs (from availableAgents in store). */
  availableAgentIds: string[];
  /** Called with the new pipeline array on Save, or [] on Clear. */
  onSave: (pipeline: string[]) => void;
  /** Whether the panel is in read-only mode (isMutating / activeRun). */
  disabled: boolean;
}

/**
 * Inline pipeline field editor.
 *
 * Collapsed (no pipeline): "Pipeline: (space default)" label + Configure button.
 * Collapsed (pipeline set): chip chain "a → b → c" + Edit + Clear buttons.
 * Edit mode: ordered list with ↑/↓/✕ per stage, add-stage select, Save/Cancel.
 */
function PipelineFieldEditor({
  pipeline,
  availableAgentIds,
  onSave,
  disabled,
}: PipelineFieldEditorProps): React.ReactElement {
  const [isEditing, setIsEditing]     = useState(false);
  const [draftStages, setDraftStages] = useState<string[]>([]);

  const openEditor = useCallback(() => {
    setDraftStages(pipeline ? [...pipeline] : []);
    setIsEditing(true);
  }, [pipeline]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleSave = useCallback(() => {
    onSave(draftStages);
    setIsEditing(false);
  }, [draftStages, onSave]);

  const handleClear = useCallback(() => {
    onSave([]);
  }, [onSave]);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setDraftStages((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setDraftStages((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const handleRemove = useCallback((index: number) => {
    setDraftStages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddStage = useCallback((agentId: string) => {
    if (!agentId || draftStages.includes(agentId)) return;
    setDraftStages((prev) => [...prev, agentId]);
  }, [draftStages]);

  // Agents not yet in the draft (for the add dropdown)
  const addableAgents = availableAgentIds.filter((id) => !draftStages.includes(id));

  // ── Collapsed read mode ────────────────────────────────────────────────────

  if (!isEditing) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          Pipeline
        </span>
        {pipeline && pipeline.length > 0 ? (
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1" role="list" aria-label="Pipeline stages">
              {pipeline.map((stage, i) => (
                <React.Fragment key={stage}>
                  <span
                    role="listitem"
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-variant text-text-primary border border-border"
                  >
                    {stage}
                  </span>
                  {i < pipeline.length - 1 && (
                    <span className="text-text-disabled text-xs" aria-hidden="true">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={openEditor}
                disabled={disabled}
                aria-label="Edit pipeline"
                title="Edit pipeline"
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
              >
                <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
                  edit
                </span>
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={disabled}
                aria-label="Clear pipeline"
                title="Clear pipeline (revert to space default)"
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-error hover:bg-error/10 focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
              >
                <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-text-secondary italic">
              (space default)
            </span>
            <button
              type="button"
              onClick={openEditor}
              disabled={disabled}
              aria-label="Configure pipeline"
              title="Configure pipeline"
              className="text-xs text-primary hover:text-primary/80 focus:outline-hidden focus:ring-2 focus:ring-primary rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 px-1.5 py-0.5"
            >
              Configure
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
        Pipeline
      </span>

      {/* Stage list */}
      {draftStages.length === 0 ? (
        <p className="text-sm text-text-secondary italic px-1">
          No stages — will use space default on save.
        </p>
      ) : (
        <ol className="flex flex-col gap-1" aria-label="Pipeline stage order">
          {draftStages.map((agentId, index) => (
            <li
              key={agentId}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-surface-elevated border border-border"
            >
              <span className="text-xs font-mono text-text-secondary w-4 text-right flex-shrink-0">
                {index + 1}
              </span>
              <span className="flex-1 text-sm text-text-primary font-mono truncate">
                {agentId}
              </span>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  aria-label={`Move ${agentId} up`}
                  className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-hidden focus:ring-1 focus:ring-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
                >
                  <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
                    arrow_upward
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveDown(index)}
                  disabled={index === draftStages.length - 1}
                  aria-label={`Move ${agentId} down`}
                  className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-hidden focus:ring-1 focus:ring-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
                >
                  <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
                    arrow_downward
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  aria-label={`Remove ${agentId} from pipeline`}
                  className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-surface-variant hover:text-error focus:outline-hidden focus:ring-1 focus:ring-primary transition-colors duration-100"
                >
                  <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
                    close
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Add stage dropdown */}
      {addableAgents.length > 0 && (
        <select
          aria-label="Add a stage to the pipeline"
          defaultValue=""
          onChange={(e) => { handleAddStage(e.target.value); e.currentTarget.value = ''; }}
          className="w-full px-3 py-2 rounded-md bg-surface-elevated border border-border text-sm text-text-primary focus:outline-hidden focus:ring-2 focus:ring-primary transition-colors duration-150"
        >
          <option value="" disabled>Add stage...</option>
          {addableAgents.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      )}

      {/* Save / Cancel */}
      <div className="flex gap-2 justify-end">
        <Button
          variant="ghost"
          onClick={handleCancel}
          className="text-xs px-3 py-1.5"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          className="text-xs px-3 py-1.5"
        >
          Save pipeline
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Task detail panel — no props required.
 * Reads detailTask from the store; renders null when the panel is closed.
 */
export function TaskDetailPanel(): React.ReactElement | null {
  const detailTask           = useAppStore((s) => s.detailTask);
  const closeDetailPanel     = useAppStore((s) => s.closeDetailPanel);
  const updateTask           = useAppStore((s) => s.updateTask);
  const addComment           = useAppStore((s) => s.addComment);
  const patchComment         = useAppStore((s) => s.patchComment);
  const isMutating           = useAppStore((s) => s.isMutating);
  const tasks                = useAppStore((s) => s.tasks);
  const showToast            = useAppStore((s) => s.showToast);
  const loadAgents           = useAppStore((s) => s.loadAgents);
  const openAttachmentModal  = useAppStore((s) => s.openAttachmentModal);
  const activeSpaceId        = useAppStore((s) => s.activeSpaceId);
  const activeRun            = useActiveRun();
  const availableAgents      = useAvailableAgents();

  /** True when the viewport is ≥768px — switches from mobile-slider to desktop-modal. */
  const isDesktop = useMediaQuery('(min-width: 768px)');

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

  // BUG-001: Ensure agents are loaded when the panel opens so the pipeline
  // editor's "Add stage" dropdown is populated. Guard prevents redundant
  // fetches if agents were already loaded by AgentLauncherMenu or the modal.
  useEffect(() => {
    if (!detailTask) return;
    if (availableAgents.length === 0) {
      loadAgents();
    }
  }, [detailTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Re-run only when a different task is opened, matching the sync effect above.

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

  // T-009: pipeline save handler
  const handlePipelineSave = useCallback((pipeline: string[]) => {
    if (!detailTask) return;
    updateTask(detailTask.id, { pipeline });
  }, [detailTask, updateTask]);

  // Comment handlers — delegate to the store so the board badge refreshes.
  const handleCommentCreated = useCallback(
    async (payload: { author: string; text: string; type: Comment['type']; parentId?: string; targetAgent?: string }) => {
      if (!detailTask) return;
      await addComment(detailTask.id, payload);
    },
    [detailTask, addComment],
  );

  const handleCommentUpdated = useCallback(
    async (commentId: string, patch: { resolved?: boolean; text?: string }) => {
      if (!detailTask) return;
      await patchComment(detailTask.id, commentId, patch);
    },
    [detailTask, patchComment],
  );

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

  // ── Shared sub-elements ──────────────────────────────────────────────────

  const columnBadge = column && (
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
  );

  const closeButton = (
    <button
      onClick={closeDetailPanel}
      aria-label="Close task detail"
      className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-hidden focus:ring-2 focus:ring-primary transition-colors duration-150 flex-shrink-0"
    >
      <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
        close
      </span>
    </button>
  );

  /** All editable fields (title, type, assigned, description, pipeline, attachments). */
  const fieldsContent = (
    <>
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
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-hidden focus:ring-2 focus:ring-primary transition-colors duration-150"
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
          className="w-full px-3 py-2 rounded-md bg-surface-elevated border border-border text-sm text-text-primary placeholder-text-disabled focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
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
              className={`flex-1 py-1.5 text-xs font-medium capitalize transition-colors duration-150 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed ${
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
          className="w-full px-3 py-2 rounded-md bg-surface-elevated border border-border text-sm text-text-primary placeholder-text-disabled focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
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
          className="w-full px-3 py-2 rounded-md bg-surface-elevated border border-border text-sm text-text-primary placeholder-text-disabled focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed resize-none transition-colors duration-150"
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

      {/* ── Pipeline (T-009) ────────────────────────────────────── */}
      <PipelineFieldEditor
        pipeline={detailTask.pipeline}
        availableAgentIds={availableAgents.map((a) => a.id)}
        onSave={handlePipelineSave}
        disabled={fieldDisabled}
      />

      {/* ── Attachments ──────────────────────────────────────────── */}
      {detailTask.attachments && detailTask.attachments.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="attachments-section">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Attachments
          </span>
          <ul className="flex flex-col gap-1" aria-label="Task attachments">
            {detailTask.attachments.map((att, index) => (
              <li key={index}>
                <button
                  type="button"
                  data-testid="attachment-row"
                  onClick={() => openAttachmentModal(activeSpaceId, detailTask.id, index, att.name, detailTask.attachments ?? [])}
                  aria-label={`Open attachment ${att.name}`}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-surface-elevated border border-border text-left hover:bg-surface-variant hover:text-primary focus:outline-hidden focus:ring-2 focus:ring-primary transition-colors duration-150"
                >
                  <span
                    className="material-symbols-outlined text-base leading-none text-text-secondary flex-shrink-0"
                    aria-hidden="true"
                  >
                    {att.type === 'file' ? 'folder' : 'attach_file'}
                  </span>
                  <span className="flex-1 truncate font-mono text-xs text-text-primary">
                    {att.name}
                  </span>
                  <span
                    className="material-symbols-outlined text-sm leading-none text-text-disabled flex-shrink-0"
                    aria-hidden="true"
                  >
                    open_in_new
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  const commentsContent = (
    <div className="flex flex-col gap-1.5" data-testid="comments-panel">
      <CommentsSection
        spaceId={activeSpaceId}
        taskId={detailTask.id}
        comments={detailTask.comments ?? []}
        onCommentCreated={handleCommentCreated}
        onCommentUpdated={handleCommentUpdated}
        disabled={fieldDisabled}
      />
    </div>
  );

  const timestampsContent = (
    <>
      <span className="text-xs text-text-disabled">
        Created: {formatTimestamp(detailTask.createdAt)}
      </span>
      <span className="text-xs text-text-disabled">
        Updated: {formatTimestamp(detailTask.updatedAt)}
      </span>
    </>
  );

  // ── Desktop: centered modal with 2-column grid ────────────────────────────

  if (isDesktop) {
    return (
      <>
        {/* Backdrop — z-[105] to sit above the sticky header */}
        <div
          className="fixed inset-0 z-[105] bg-black/35"
          aria-hidden="true"
          onClick={closeDetailPanel}
        />

        {/*
          Centering wrapper — pointer-events-none so backdrop clicks pass through.
          The inner modal restores pointer events.
        */}
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-6 pointer-events-none">
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Task detail"
            data-testid="task-detail-modal"
            className="pointer-events-auto bg-surface border border-border rounded-modal shadow-modal w-full max-w-[600px] lg:max-w-[800px] max-h-[90vh] flex flex-col animate-scale-in"
          >
            {/* ── Modal header ──────────────────────────────────── */}
            <div className="flex items-center justify-between gap-2 px-6 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-mono text-text-secondary bg-surface-variant px-1.5 py-0.5 rounded-sm flex-shrink-0">
                  {shortId}
                </span>
                {columnBadge}
              </div>
              {closeButton}
            </div>

            {/*
              ── Modal body — 2-column grid ──────────────────────
              Left column (55%): editable fields + timestamps.
              Right column (45%): threaded comments with independent scroll.
              Both columns overflow-y-auto for independent scrolling.
            */}
            <div className="flex flex-1 overflow-hidden min-h-0">
              {/* Left: fields */}
              <div
                className="w-[55%] overflow-y-auto px-6 py-5 flex flex-col gap-5 border-r border-border min-w-0"
                aria-label="Task fields"
              >
                {fieldsContent}

                {/* Timestamps at the bottom of the left column */}
                <div className="flex flex-col gap-1 pt-2 mt-auto">
                  {timestampsContent}
                </div>
              </div>

              {/* Right: comments */}
              <div
                className="w-[45%] overflow-y-auto px-6 py-5 min-w-0"
                aria-label="Comments"
              >
                {commentsContent}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Mobile: slide-in panel from the right ────────────────────────────────

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
            {columnBadge}
          </div>
          {closeButton}
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
          {fieldsContent}
          {commentsContent}
        </div>

        {/* ── Footer — read-only metadata ──────────────────────────────── */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-border flex flex-col gap-1">
          {timestampsContent}
        </div>
      </div>
    </>
  );
}
