/**
 * Task detail & edit panel — unified right slide-over.
 *
 * All viewports: fixed right-side panel (slide-over), tabbed layout.
 *   - Mobile (<768px): w-full (fullscreen).
 *   - Desktop (≥768px): md:w-[420px] lg:w-[520px].
 *
 * Clicking a .md attachment skips the AttachmentModal preview and opens the
 * MarkdownModal reader directly (one click to read a document).
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
import { useAppStore, useActiveRun, useAvailableAgents, usePipelineStates } from '@/stores/useAppStore';
import { Button } from '@/components/shared/Button';
import { ArcAutocomplete } from '@/components/shared/ArcAutocomplete';
import { ReferenceAutocomplete } from '@/components/folio/ReferenceAutocomplete';
import { CommentsSection } from '@/components/board/CommentsSection';
import { formatTimestamp } from '@/utils/formatTimestamp';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { resolveAgentName } from '@/utils/agentName';
import * as api from '@/api/client';
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
  /** Active space — used to resolve agent nicknames for display. */
  activeSpace: import('@/types').Space | null;
  /** Zero-based index of the currently running stage, if a run is active. */
  currentStageIndex?: number;
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
  activeSpace,
  currentStageIndex,
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
      <div className="flex flex-col gap-2">
        {/* Section label + action buttons */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">
            Pipeline Stage
          </span>
          <div className="flex items-center gap-1">
            {pipeline && pipeline.length > 0 ? (
              <>
                {/* touch-target-size: min 44×44px — use p-2.5 to expand hit area */}
                <button
                  type="button"
                  onClick={openEditor}
                  disabled={disabled}
                  aria-label="Edit pipeline"
                  title="Edit pipeline"
                  className="p-2.5 -m-1 flex items-center justify-center rounded text-text-disabled hover:text-text-secondary hover:bg-surface-variant focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-[180ms] ease-spring"
                >
                  <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">edit</span>
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={disabled}
                  aria-label="Clear pipeline"
                  title="Clear pipeline"
                  className="p-2.5 -m-1 flex items-center justify-center rounded text-text-disabled hover:text-error hover:bg-error/10 focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-[180ms] ease-spring"
                >
                  <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">close</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={openEditor}
                disabled={disabled}
                aria-label="Configure pipeline"
                className="text-[11px] text-primary hover:text-primary/80 focus:outline-hidden focus:ring-2 focus:ring-primary rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast px-1 py-0.5"
              >
                Configure
              </button>
            )}
          </div>
        </div>

        {/* Vertical timeline */}
        {pipeline && pipeline.length > 0 ? (
          <div className="relative" role="list" aria-label="Pipeline stages">
            {/* Connecting line */}
            <div
              className="absolute left-[9px] top-4 bottom-4 w-px bg-border/60"
              aria-hidden="true"
            />
            {pipeline.map((stage, i) => {
              const isActive = currentStageIndex === i;
              const isDone   = currentStageIndex !== undefined && i < currentStageIndex;
              return (
                <div
                  key={stage}
                  role="listitem"
                  aria-current={isActive ? 'step' : undefined}
                  className="flex items-center gap-3 py-[7px] relative"
                >
                  {/* Dot / check icon — size difference is the non-color cue (color-not-only) */}
                  {isActive ? (
                    <div
                      className="w-[18px] h-[18px] rounded-full bg-primary flex-shrink-0 shadow-[0_0_0_4px_rgba(124,109,250,0.15)]"
                      aria-hidden="true"
                    />
                  ) : isDone ? (
                    <span
                      className="material-symbols-outlined text-[14px] leading-none text-primary/40 flex-shrink-0 ml-[2px]"
                      aria-hidden="true"
                    >
                      check
                    </span>
                  ) : (
                    <div className="w-2 h-2 rounded-full flex-shrink-0 ml-[5px] bg-border" aria-hidden="true" />
                  )}
                  {/* Label */}
                  <span className={`text-[13px] leading-none transition-colors duration-150 ${
                    isActive
                      ? 'font-semibold text-primary'
                      : isDone
                      ? 'text-text-disabled'
                      : 'text-text-secondary'
                  }`}>
                    {resolveAgentName(stage, activeSpace)}
                    {/* visually hidden state label for screen readers */}
                    {isActive && <span className="sr-only"> (current)</span>}
                    {isDone   && <span className="sr-only"> (completed)</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <span className="text-sm text-text-disabled italic pl-1">(space default)</span>
        )}
      </div>
    );
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">
        Pipeline
      </span>

      {/* Stage list */}
      {draftStages.length === 0 ? (
        <p className="text-sm text-text-disabled italic px-1">
          No stages — will use space default on save.
        </p>
      ) : (
        <ol className="flex flex-col gap-1" aria-label="Pipeline stage order">
          {draftStages.map((agentId, index) => (
            <li
              key={agentId}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-elevated border border-border"
            >
              <span className="text-xs font-mono text-text-disabled w-4 text-right flex-shrink-0">
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
                  className="w-6 h-6 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-hidden focus:ring-1 focus:ring-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-[180ms] ease-spring"
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
                  className="w-6 h-6 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-hidden focus:ring-1 focus:ring-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-[180ms] ease-spring"
                >
                  <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
                    arrow_downward
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  aria-label={`Remove ${agentId} from pipeline`}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-error focus:outline-hidden focus:ring-1 focus:ring-primary transition-all duration-[180ms] ease-spring"
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
          className="w-full px-3 py-2.5 rounded-lg bg-surface-elevated border border-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary transition-all duration-fast"
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
  const openMarkdownModal    = useAppStore((s) => s.openMarkdownModal);
  const activeSpaceId        = useAppStore((s) => s.activeSpaceId);
  const activeSpace          = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId) ?? null);
  const activeRun            = useActiveRun();
  const availableAgents      = useAvailableAgents();
  const pipelineStates       = usePipelineStates();

  // ── Local field state ────────────────────────────────────────────────────

  const [localTitle, setLocalTitle]             = useState('');
  const [localAssigned, setLocalAssigned]       = useState('');
  const [localArc, setLocalArc]                 = useState('');
  const [localDescription, setLocalDescription] = useState('');
  const [localType, setLocalType]               = useState<'feature' | 'bug' | 'tech-debt' | 'chore'>('chore');
  /** Mobile tab — shown only when viewport is <768px (two-column doesn't fit). */
  const [mobileTab, setMobileTab]               = useState<'content' | 'details'>('content');
  const [isCopied, setIsCopied]                 = useState(false);
  /** Index of attachment currently being fetched for direct .md → reader opening. */
  const [loadingAttachmentIndex, setLoadingAttachmentIndex] = useState<number | null>(null);

  // Track initial values to detect actual changes on blur.
  const savedTitle       = useRef('');
  const savedAssigned    = useRef('');
  const savedArc         = useRef('');

  // ── Refs for focus management ────────────────────────────────────────────

  const panelRef         = useRef<HTMLDivElement | null>(null);
  const titleInputRef    = useRef<HTMLTextAreaElement | null>(null);
  const descTextareaRef  = useRef<HTMLTextAreaElement | null>(null);
  /** Element that triggered the panel open — focus returns here on close. */
  const triggerRef       = useRef<Element | null>(null);

  // ── Sync local state when detailTask changes ─────────────────────────────

  useEffect(() => {
    if (!detailTask) return;

    setLocalTitle(detailTask.title);
    setLocalAssigned(detailTask.assigned ?? '');
    setLocalArc(detailTask.arc ?? '');
    setLocalDescription(detailTask.description ?? '');
    setLocalType(detailTask.type);

    savedTitle.current    = detailTask.title;
    savedAssigned.current = detailTask.assigned ?? '';
    savedArc.current      = detailTask.arc ?? '';

    // Capture the currently focused element as the trigger before the panel
    // steals focus.
    triggerRef.current = document.activeElement;

    // Focus goes to the panel container (not the title input) so the modal
    // is keyboard-accessible without immediately entering edit mode.
    requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
  }, [detailTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only re-sync when a different task is opened, not on every field update.

  // Auto-grow title textarea. Setting height='0' first forces browsers to
  // recalculate scrollHeight correctly even with overflow-y:hidden.
  useEffect(() => {
    const el = titleInputRef.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
  }, [localTitle]);

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

  // Auto-grow description textarea — runs on every content change and on
  // initial mount (when localDescription is set from detailTask).
  useEffect(() => {
    const el = descTextareaRef.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
  }, [localDescription]);

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
        // If a foreground modal (MarkdownModal or AttachmentModal) is open,
        // let its own Escape handler fire first. Standard UX: Escape dismisses
        // the topmost layer, not the panel behind it.
        const hasOpenModal = document.querySelector(
          '[id="markdown-modal-title"], [id="attachment-modal-title"]'
        );
        if (hasOpenModal) return;
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

  const handleArcBlur = useCallback(() => {
    if (!detailTask) return;
    const trimmed = localArc.trim();
    if (trimmed === savedArc.current) return;
    savedArc.current = trimmed;
    // Empty string clears the arc on the server
    updateTask(detailTask.id, { arc: trimmed });
  }, [detailTask, localArc, updateTask]);

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

  /**
   * Attachment click handler.
   * - .md files: fetch content then open MarkdownModal directly (one click).
   * - Other types: open AttachmentModal as before.
   */
  const handleAttachmentClick = useCallback(async (index: number, name: string) => {
    if (!detailTask) return;
    const att = detailTask.attachments?.[index];
    // Link type — open directly, skip modal
    if (att?.type === 'link') {
      window.open(att!.content, '_blank', 'noopener,noreferrer');
      return;
    }
    if (name.toLowerCase().endsWith('.md')) {
      setLoadingAttachmentIndex(index);
      try {
        const data = await api.getAttachmentContent(activeSpaceId, detailTask.id, index);
        openMarkdownModal(name, data.content, data.source);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load document';
        showToast(message, 'error');
      } finally {
        setLoadingAttachmentIndex(null);
      }
    } else {
      openAttachmentModal(activeSpaceId, detailTask.id, index, name, detailTask.attachments ?? []);
    }
  }, [detailTask, activeSpaceId, openMarkdownModal, openAttachmentModal, showToast]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (!detailTask) return null;

  const column = findTaskColumn(tasks, detailTask.id);
  const columnLabel = column ? COLUMN_LABELS[column] : '';

  /** Short ID chip — last 7 chars for display. */
  const shortId = `#${detailTask.id.slice(-7)}`;

  const isActiveRun = activeRun?.taskId === detailTask.id;
  const fieldDisabled = isReadOnly;

  // Find pipeline state for this task (for currentStageIndex)
  const taskPipelineState = Object.values(pipelineStates).find(
    (ps) => ps.taskId === detailTask.id && (ps.status === 'running' || ps.status === 'paused' || ps.status === 'blocked')
  );

  // ── Shared sub-elements ──────────────────────────────────────────────────

  const columnBadge = column && (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium leading-none uppercase tracking-wide flex-shrink-0 ${
        column === 'done'
          ? 'bg-col-done-pill text-badge-done-text'
          : column === 'in-progress'
          ? 'bg-col-in-progress-pill text-primary'
          : 'bg-surface-variant text-text-secondary'
      }`}
    >
      {columnLabel}
    </span>
  );

  const closeButton = (
    <button
      onClick={closeDetailPanel}
      aria-label="Close task detail"
      className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-surface-variant hover:text-text-primary focus:outline-hidden focus:ring-2 focus:ring-primary active:scale-[0.90] transition-all duration-[150ms] ease-spring flex-shrink-0"
    >
      <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
        close
      </span>
    </button>
  );

  // ── Two-column centered modal ────────────────────────────────────────────
  // Left (flex-1): title, description, comments.
  // Right (w-[280px], elevated): ID, type, assigned, pipeline, attachments, timestamps.

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[105] bg-black/30 dark:bg-black/72 backdrop-blur-[10px]" aria-hidden="true" onClick={closeDetailPanel} />

      {/* Centering wrapper */}
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
        {/* ── Outer bezel shell — gradient ring creates the machined-hardware frame ── */}
        <div className="pointer-events-auto w-full max-w-[1200px] h-[min(90vh,840px)] flex flex-col p-[2px] rounded-[18px] bg-gradient-to-b from-black/[0.07] to-transparent dark:from-white/[0.10] dark:to-white/[0.03] shadow-[0_56px_140px_rgba(0,0,0,0.22)] dark:shadow-[0_56px_140px_rgba(0,0,0,0.55)] animate-modal-dialog-in">
          {/* ── Inner content card ─────────────────────────────────────────────────── */}
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Task detail"
            tabIndex={-1}
            className="outline-none flex-1 min-h-0 flex flex-col bg-surface rounded-modal overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
          {/* ── Header ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2.5 h-13 px-6 border-b border-border/40 flex-shrink-0 bg-surface-elevated/10">
            <span className="font-mono text-[11px] text-text-secondary bg-surface-variant/80 px-2 py-1 rounded-md flex-shrink-0 tracking-[0.1em] border border-border/40">
              {shortId}
            </span>
            {columnBadge}
            <div className="flex-1" />
            {detailTask.createdAt && (
              <time
                dateTime={detailTask.createdAt}
                title={`Created: ${formatTimestamp(detailTask.createdAt)}${detailTask.updatedAt && detailTask.updatedAt !== detailTask.createdAt ? `\nUpdated: ${formatTimestamp(detailTask.updatedAt)}` : ''}`}
                className="text-[11px] text-text-tertiary cursor-default hidden sm:block"
              >
                {formatRelativeTime(detailTask.createdAt)}
              </time>
            )}
            {closeButton}
          </div>

          {/* ── Mobile tab bar — visible only below md breakpoint ────── */}
          <div className="md:hidden flex border-b border-border/40 flex-shrink-0">
            {(['content', 'details'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMobileTab(tab)}
                className={`flex-1 py-2.5 text-xs font-medium capitalize transition-all duration-[200ms] ease-spring focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                  mobileTab === tab
                    ? 'text-text-primary border-b-2 border-primary -mb-px bg-primary/[0.04]'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated/30'
                }`}
              >
                {tab === 'content' ? 'Content' : 'Details'}
              </button>
            ))}
          </div>

          {/* ── Two-column body (desktop) / single-panel (mobile) ────── */}
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-b-modal">

            {/* ── LEFT: title · description · comments ──────────────── */}
            <div className={`min-w-0 overflow-y-auto px-14 pt-7 pb-8 flex flex-col gap-6 md:flex-1 ${mobileTab === 'content' ? 'flex-1' : 'hidden md:flex'}`}>
              {isActiveRun && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-warning/[0.08] border border-warning/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <span className="material-symbols-outlined text-warning text-[16px] leading-none flex-shrink-0 animate-run-pulse" aria-hidden="true">motion_mode</span>
                  <p className="text-[12px] font-medium text-warning/90 leading-snug tracking-wide">Pipeline running — editing paused</p>
                </div>
              )}

              {/* Title — textarea wraps long titles instead of truncating */}
              <div className="animate-fade-in-up [animation-delay:50ms]">
              <textarea
                id="detail-title"
                ref={titleInputRef}
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    titleInputRef.current?.blur();
                  }
                }}
                disabled={fieldDisabled}
                aria-disabled={fieldDisabled}
                aria-label="Task title"
                className="w-full bg-transparent border-b border-transparent hover:border-border/40 focus:border-primary/50 text-[26px] font-semibold text-text-primary placeholder:text-text-disabled/50 focus:outline-none leading-snug pb-1 min-h-[2rem] resize-none overflow-y-hidden disabled:opacity-40 disabled:cursor-not-allowed transition-[border-color] duration-[220ms] ease-spring"
                placeholder="Task title"
              />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5 animate-fade-in-up [animation-delay:110ms]">
                <label htmlFor="detail-description" className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">
                  Description
                </label>
                <ReferenceAutocomplete
                  value={localDescription}
                  onChange={setLocalDescription}
                  inputRef={descTextareaRef}
                  textareaProps={{
                    id: 'detail-description',
                    onBlur: handleSaveDescription,
                    disabled: fieldDisabled,
                    'aria-disabled': fieldDisabled,
                    rows: 1,
                    className: "w-full px-0 py-0 bg-transparent border-b border-transparent hover:border-border/25 focus:border-primary/35 font-sans text-[14px] text-text-secondary leading-relaxed placeholder:text-text-disabled/40 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed resize-none [overflow-y:hidden] min-h-[6rem] transition-[border-color] duration-[220ms] ease-spring",
                    placeholder: "Add a description… type [[ for a folio reference",
                  }}
                />
              </div>

              {/* Comments */}
              <div className="border-t border-border/30 pt-6 animate-fade-in-up [animation-delay:170ms]" data-testid="comments-panel">
                <CommentsSection
                  spaceId={activeSpaceId}
                  taskId={detailTask.id}
                  comments={detailTask.comments ?? []}
                  onCommentCreated={handleCommentCreated}
                  onCommentUpdated={handleCommentUpdated}
                  disabled={fieldDisabled}
                />
              </div>
            </div>

            {/* ── RIGHT: metadata sidebar ────────────────────────────── */}
            <div className={`flex-shrink-0 border-border/40 bg-surface-elevated/25 overflow-y-auto px-6 pt-6 pb-6 flex flex-col divide-y divide-border/20 md:w-[340px] md:border-l ${mobileTab === 'details' ? 'flex-1' : 'hidden md:flex'}`}>

              {/* ID */}
              <div className="flex flex-col gap-2 pb-5 animate-fade-in-up [animation-delay:80ms]">
                <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">ID</span>
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-mono text-xs text-text-secondary bg-surface border border-border/40 rounded-lg px-3 py-2 select-all overflow-x-auto whitespace-nowrap min-w-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    {detailTask.id}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyId}
                    aria-label="Copy task ID"
                    title="Copy task ID"
                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-surface-variant hover:text-text-primary focus:outline-hidden focus:ring-2 focus:ring-primary active:scale-[0.90] transition-all duration-[150ms] ease-spring"
                  >
                    <span className="material-symbols-outlined text-[17px] leading-none" aria-hidden="true">
                      {isCopied ? 'check' : 'content_copy'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Type */}
              <div className="flex flex-col gap-2 py-5 animate-fade-in-up [animation-delay:130ms]">
                <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">Task Type</span>
                <div role="group" aria-label="Task type" className="flex flex-wrap gap-2">
                  {(['feature', 'bug', 'tech-debt', 'chore'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={localType === t}
                      onClick={() => handleTypeChange(t)}
                      disabled={fieldDisabled}
                      aria-disabled={fieldDisabled}
                      className={`px-3 py-1.5 text-xs font-medium capitalize rounded-full border transition-all duration-[180ms] ease-spring focus:outline-hidden focus:ring-2 focus:ring-primary active:scale-[0.94] disabled:opacity-40 disabled:cursor-not-allowed ${
                        localType === t
                          ? 'bg-primary/15 border-primary/35 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                          : 'bg-surface/50 border-border/40 text-text-secondary hover:bg-surface-variant hover:border-border/70 hover:text-text-primary'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assigned */}
              <div className="flex flex-col gap-2 py-5 animate-fade-in-up [animation-delay:180ms]">
                <label htmlFor="detail-assigned" className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">Assigned To</label>
                <input
                  id="detail-assigned"
                  type="text"
                  value={localAssigned}
                  onChange={(e) => setLocalAssigned(e.target.value)}
                  onBlur={handleAssignedBlur}
                  disabled={fieldDisabled}
                  aria-disabled={fieldDisabled}
                  className="w-full px-3 py-2 rounded-lg bg-surface/60 border border-border/40 text-sm text-text-primary placeholder:text-text-disabled/50 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-[220ms] ease-spring shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                  placeholder="Assign to someone..."
                />
              </div>

              {/* Arc */}
              <div
                className="flex flex-col gap-2 py-5 animate-fade-in-up [animation-delay:205ms]"
                onBlur={(e) => {
                  // Save when focus leaves the entire arc section (container + dropdown)
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    handleArcBlur();
                  }
                }}
              >
                <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">Arc</span>
                <ArcAutocomplete
                  value={localArc}
                  onChange={setLocalArc}
                  spaceId={activeSpaceId}
                  placeholder="e.g. QOL, AUTH, LOOP"
                  className="w-full"
                />
              </div>

              {/* Pipeline */}
              <div className="py-5 animate-fade-in-up [animation-delay:230ms]">
                <PipelineFieldEditor
                  pipeline={detailTask.pipeline}
                  availableAgentIds={availableAgents.map((a) => a.id)}
                  onSave={handlePipelineSave}
                  disabled={fieldDisabled}
                  activeSpace={activeSpace}
                  currentStageIndex={taskPipelineState?.currentStageIndex}
                />
              </div>

              {/* Attachments */}
              {detailTask.attachments && detailTask.attachments.length > 0 && (
                <div className="flex flex-col gap-2 py-5" data-testid="attachments-section">
                  <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">Attachments</span>
                  <div className="flex flex-col gap-1.5" aria-label="Task attachments">
                    {detailTask.attachments.map((att, index) => (
                      <React.Fragment key={index}>
                        {att.type === 'link' ? (
                          <a
                            href={att.content}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="attachment-row"
                            aria-label={`Open link ${att.name} in new tab`}
                            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface/50 border border-border/35 hover:bg-surface-variant hover:border-primary/30 hover:translate-x-0.5 focus:outline-hidden focus:ring-2 focus:ring-primary transition-all duration-[200ms] ease-spring group"
                          >
                            <span className="material-symbols-outlined text-[15px] leading-none text-primary flex-shrink-0" aria-hidden="true">link</span>
                            <span className="font-mono text-xs text-text-primary truncate flex-1">{att.name}</span>
                            <span className="material-symbols-outlined text-[13px] leading-none text-text-disabled group-hover:text-text-secondary flex-shrink-0" aria-hidden="true">open_in_new</span>
                          </a>
                        ) : (
                          <button
                            type="button"
                            data-testid="attachment-row"
                            onClick={() => handleAttachmentClick(index, att.name)}
                            disabled={loadingAttachmentIndex === index}
                            aria-label={`Open attachment ${att.name}`}
                            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface/50 border border-border/35 hover:bg-surface-variant hover:border-primary/30 hover:translate-x-0.5 focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-wait transition-all duration-[200ms] ease-spring text-left group"
                          >
                            <span className={`material-symbols-outlined text-[15px] leading-none flex-shrink-0 ${loadingAttachmentIndex === index ? 'animate-spin text-text-disabled' : att.name.toLowerCase().endsWith('.md') ? 'text-primary' : 'text-text-secondary'}`} aria-hidden="true">
                              {loadingAttachmentIndex === index ? 'progress_activity' : att.name.toLowerCase().endsWith('.md') ? 'description' : att.type === 'file' ? 'folder' : 'attach_file'}
                            </span>
                            <span className="font-mono text-xs text-text-primary truncate flex-1">{att.name}</span>
                            <span className="material-symbols-outlined text-[13px] leading-none text-text-disabled group-hover:text-text-secondary flex-shrink-0" aria-hidden="true">
                              {loadingAttachmentIndex === index ? '' : 'download'}
                            </span>
                          </button>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
          </div>
          {/* /inner content card */}
        </div>
        {/* /outer bezel */}
      </div>
    </>
  );
}
