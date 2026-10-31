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
import { useAppStore } from '@/stores/useAppStore';
import { useCanEdit } from '@/stores/useAuthStore';
import { LabelsInput } from '@/components/shared/LabelsInput';
import { AssigneeSelect } from '@/components/shared/AssigneeSelect';
import { ChildIssues } from '@/components/board/ChildIssues';
import { IssueHistory } from '@/components/board/IssueHistory';
import { isOverdue, parentIssueOf, PRIORITIES, TYPES } from '@/utils/issues';
import { CommentsSection } from '@/components/board/CommentsSection';
import { TaskRunPanel } from '@/components/runs/TaskRunPanel';
import { useTaskRunStore } from '@/stores/useTaskRunStore';
import { DependsOnSection } from '@/components/board/DependsOnSection';
import { formatTimestamp } from '@/utils/formatTimestamp';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import * as api from '@/api/client';
import type { Comment, ModelCliTool, Priority, Task, TaskType, UpdateTaskPayload } from '@/types';
import { agentIsOn } from '@/utils/agents';

// ---------------------------------------------------------------------------
// Shared input style for the details column's editable fields
// so they read as a set. The read-only ID box reuses the same surface tokens
// (bg/border/radius/inset) inline since it's a <span>, not an <input>.
// ---------------------------------------------------------------------------

const SIDE_FIELD = 'grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 py-1';
const SIDE_LABEL = 'text-xs text-text-secondary';

// A value until pointed at: the column is read far more often than edited.
const DETAIL_FIELD_BASE =
  'w-full h-8 px-2 rounded-md bg-transparent border border-transparent text-sm cursor-pointer ' +
  'placeholder:text-text-secondary hover:bg-surface-variant/60 focus:bg-surface focus:cursor-text focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast';
const DETAIL_FIELD_CLASS = `${DETAIL_FIELD_BASE} text-text-primary`;
// A select insets its text by a few more pixels than an input does: this lines them up.
const DETAIL_INPUT_CLASS = `${DETAIL_FIELD_CLASS} pl-3`;

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
  const detailTask           = useAppStore((s) => s.detailTask);
  const closeDetailPanel     = useAppStore((s) => s.closeDetailPanel);
  const updateTask           = useAppStore((s) => s.updateTask);
  const addComment           = useAppStore((s) => s.addComment);
  const patchComment         = useAppStore((s) => s.patchComment);
  const answerQuestion       = useAppStore((s) => s.answerQuestion);
  const detailLoaded         = useAppStore((s) => s.detailLoaded);
  const detailFailed         = useAppStore((s) => s.detailFailed);
  const allEpics             = useAppStore((s) => s.epics);
  const moveTask             = useAppStore((s) => s.moveTask);
  const statuses             = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId)?.statuses) ?? [];
  const openDetailPanel      = useAppStore((s) => s.openDetailPanel);
  const showToast            = useAppStore((s) => s.showToast);
  const openAttachmentModal  = useAppStore((s) => s.openAttachmentModal);
  const canEdit              = useCanEdit();
  const activeSpace          = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId));
  const openMarkdownModal    = useAppStore((s) => s.openMarkdownModal);
  const activeSpaceId        = useAppStore((s) => s.activeSpaceId);

  const isOpen = detailTask !== null;
  // A card only has the beginning of the description, and what is on screen until the whole
  // issue arrives must never be saved: it would cut the description short for good.
  const descriptionReady = detailLoaded && !detailTask?.descriptionTruncated;

  // Keeps "Created 5 min ago" true while the panel stays open.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    if (!isOpen) return undefined;
    const id = setInterval(() => setClockTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [isOpen]);

  // ── Local field state ────────────────────────────────────────────────────

  const [localTitle, setLocalTitle]             = useState('');
  const [localAssigned, setLocalAssigned]       = useState('');
  const [localDescription, setLocalDescription] = useState('');
  const [localEstimate, setLocalEstimate]       = useState('');
  const [localDueDate, setLocalDueDate]         = useState('');
  const [activityTab, setActivityTab]           = useState<'comments' | 'history'>('comments');
  const [localDependsOn, setLocalDependsOn]     = useState<string[]>([]);
  /** Mobile tab — shown only when viewport is <768px (two-column doesn't fit). */
  const [mobileTab, setMobileTab]               = useState<'content' | 'details'>('content');
  const [isCopied, setIsCopied]                 = useState(false);
  /** Index of attachment currently being fetched for direct .md → reader opening. */
  const [loadingAttachmentIndex, setLoadingAttachmentIndex] = useState<number | null>(null);

  // Track initial values to detect actual changes on blur.
  const savedTitle       = useRef('');
  const savedAssigned    = useRef('');
  /** What the description said when this edit of it began. */
  const descriptionBase  = useRef('');

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
    setLocalDescription(detailTask.description ?? '');
    descriptionBase.current = detailTask.description ?? '';
    setLocalEstimate(detailTask.estimate != null ? String(detailTask.estimate) : '');
    setLocalDueDate(detailTask.dueDate ?? '');
    setActivityTab('comments');
    setLocalDependsOn(detailTask.dependsOn ?? []);

    savedTitle.current    = detailTask.title;
    savedAssigned.current = detailTask.assigned ?? '';

    // Capture the currently focused element as the trigger before the panel
    // steals focus.
    // Not when going from an issue to another: what opened the panel is where focus returns.
    if (!prevDetailTask.current) triggerRef.current = document.activeElement;

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
  }, [localTitle, detailTask?.id, isOpen, mobileTab]);

  // Auto-grow description textarea — runs on every content change and on
  // initial mount (when localDescription is set from detailTask).
  useEffect(() => {
    const el = descTextareaRef.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
    // Closing unmounts the fields, and a hidden tab measures nothing: measure again on coming back.
  }, [localDescription, detailTask?.id, isOpen, mobileTab]);

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

  const shellRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  useFocusTrap(panelRef, detailTask !== null);

  const closePanelRef = useRef<() => void>(() => {});

  // ── Escape key handler ───────────────────────────────────────────────────

  useEffect(() => {
    if (!detailTask) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // If a foreground modal (MarkdownModal or AttachmentModal) is open,
        // let its own Escape handler fire first. Standard UX: Escape dismisses
        // the topmost layer, not the panel behind it.
        const hasOpenModal = document.querySelector(
          '[id="markdown-modal-title"], [id="attachment-modal-title"], [data-testid="agent-picker-menu"]'
        ) || [...document.querySelectorAll('[aria-modal="true"]')].some((el) => el !== panelRef.current);
        if (hasOpenModal) return;
        // A field that uses Escape to cancel itself gets it first.
        if ((e.target as HTMLElement).closest?.('[data-escape-local]')) return;
        e.stopPropagation();
        // Leaving the field saves what it holds, as clicking outside does.
        closePanelRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [detailTask]);

  // A save that failed rolled the issue back, and the fields must not keep what was refused.
  const isMutating = useAppStore((s) => (s.detailTask ? s.mutatingTaskIds.has(s.detailTask.id) : false));
  const wasMutating = useRef(false);
  useEffect(() => {
    const finished = wasMutating.current && !isMutating;
    wasMutating.current = isMutating;
    const task = useAppStore.getState().detailTask;
    if (!finished || !task) return;
    const focused = document.activeElement;
    if (focused?.id !== 'detail-assigned') { setLocalAssigned(task.assigned ?? ''); savedAssigned.current = task.assigned ?? ''; }
    if (focused?.id !== 'detail-estimate') setLocalEstimate(task.estimate != null ? String(task.estimate) : '');
    if (focused?.id !== 'detail-due') setLocalDueDate(task.dueDate ?? '');
  }, [isMutating]);

  // The whole issue arrived, and it may say more than what it was opened with.
  useEffect(() => {
    if (!detailLoaded) return;
    const task = useAppStore.getState().detailTask;
    if (!task) return;
    const focused = document.activeElement;
    if (focused?.id !== 'detail-assigned') { setLocalAssigned(task.assigned ?? ''); savedAssigned.current = task.assigned ?? ''; }
    if (focused?.id !== 'detail-estimate') setLocalEstimate(task.estimate != null ? String(task.estimate) : '');
    if (focused?.id !== 'detail-due') setLocalDueDate(task.dueDate ?? '');
  }, [detailLoaded]);

  // Who else it waits for can change from elsewhere, and nothing here edits it as text.
  const liveDependsOn = (detailTask?.dependsOn ?? []).join(',');
  useEffect(() => {
    setLocalDependsOn(liveDependsOn ? liveDependsOn.split(',') : []);
  }, [liveDependsOn]);

  // ── Save helpers ─────────────────────────────────────────────────────────

  const taskRunView = useTaskRunStore((s) => (detailTask ? s.views[detailTask.id] : undefined));

  // What opened the panel may be a card or just a name, so nothing is editable until the whole
  // issue is here: a field that only looks empty would replace what it really holds.
  const handleTitleBlur = useCallback(() => {
    if (!detailLoaded) return;
    const trimmed = localTitle.trim();
    if (!detailTask || trimmed === savedTitle.current.trim()) return;
    if (!trimmed) {
      // Revert empty title to last saved value (never send blank title).
      setLocalTitle(savedTitle.current);
      return;
    }
    void updateTask(detailTask.id, { title: trimmed, base: { title: savedTitle.current } });
  }, [detailTask, detailLoaded, localTitle, updateTask]);

  const handleAssignedChange = useCallback((assigned: string) => {
    if (!detailTask || !detailLoaded) return;
    setLocalAssigned(assigned);
    if (assigned === savedAssigned.current) return;
    savedAssigned.current = assigned;
    updateTask(detailTask.id, { assigned });
  }, [detailTask, detailLoaded, updateTask]);

  const handleEstimateBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (!detailTask || !detailLoaded) return;
    const saved = useAppStore.getState().detailTask?.estimate ?? null;
    const text = localEstimate.trim();
    const estimate = text === '' ? null : Number(text);
    // A number input reads as empty while it holds something like "5-".
    if (e.target.validity.badInput || (estimate !== null && (!isFinite(estimate) || estimate < 0))) {
      e.target.value = '';
      setLocalEstimate(saved != null ? String(saved) : '');
      return;
    }
    if (estimate !== saved) updateTask(detailTask.id, { estimate });
  }, [detailTask, detailLoaded, localEstimate, updateTask]);

  // On leaving the field: while typing a date, each digit can already make a valid one.
  const handleDueDateBlur = useCallback(() => {
    if (!detailTask || !detailLoaded) return;
    const dueDate = localDueDate || null;
    if (dueDate !== (useAppStore.getState().detailTask?.dueDate ?? null)) updateTask(detailTask.id, { dueDate });
  }, [detailTask, detailLoaded, localDueDate, updateTask]);

  const handleSaveDescription = useCallback(() => {
    if (!detailTask) return;
    if (!descriptionReady) return;
    const description = localDescription.trim();
    // Only what was written counts: what others changed meanwhile must not be undone by leaving.
    if (description === descriptionBase.current.trim()) return;
    void updateTask(detailTask.id, { description, base: { description: descriptionBase.current } });
  }, [detailTask, localDescription, updateTask, descriptionReady]);

  // What someone is writing is theirs until it is saved: nothing that arrives may replace it,
  // and a save that fails leaves it there. Text nobody has touched follows the issue as others
  // change it. While a save is on its way the board already shows it, which proves nothing.
  const liveTitle = detailTask?.title;
  const liveDescription = detailTask?.description ?? '';
  useEffect(() => {
    if (liveTitle === undefined || isMutating) return;
    const untouched = localTitle.trim() === savedTitle.current.trim();
    if (untouched || localTitle.trim() === liveTitle.trim()) {
      savedTitle.current = liveTitle;
      if (localTitle !== liveTitle) setLocalTitle(liveTitle);
    }
  }, [liveTitle, isMutating]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!descriptionReady || isMutating) return;
    const untouched = localDescription.trim() === descriptionBase.current.trim();
    if (untouched || localDescription.trim() === liveDescription.trim()) {
      descriptionBase.current = liveDescription;
      if (localDescription !== liveDescription) setLocalDescription(liveDescription);
    }
  }, [liveDescription, isMutating, descriptionReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a conflict: back to the text they chose.
  const resumedEdit = useAppStore((s) => s.resumedEdit);
  useEffect(() => {
    if (!resumedEdit || resumedEdit.taskId !== detailTask?.id) return;
    const isTitle = resumedEdit.field === 'title';
    if (isTitle) {
      savedTitle.current = resumedEdit.base;
      setLocalTitle(resumedEdit.text);
    } else {
      descriptionBase.current = resumedEdit.base;
      setLocalDescription(resumedEdit.text);
    }
    if (resumedEdit.focus) {
      requestAnimationFrame(() => (isTitle ? titleInputRef : descTextareaRef).current?.focus());
    }
    useAppStore.setState({ resumedEdit: null });
  }, [resumedEdit, detailTask?.id]);

  // Closing saves what was left unsaved, wherever the focus is: a failed save, say.
  const closePanel = useCallback(() => {
    const active = document.activeElement;
    if (active === titleInputRef.current || active === descTextareaRef.current) (active as HTMLElement).blur();
    else {
      handleTitleBlur();
      handleSaveDescription();
    }
    if (closingRef.current) return;
    const closingId = useAppStore.getState().detailTask?.id;
    // Without a re-render: the panel has nothing left to do but leave.
    const leaving = { duration: 120, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' } as const;
    const exit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? undefined
      : shellRef.current?.animate?.([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.98)' }], leaving);
    if (!exit) {
      closeDetailPanel();
      return;
    }
    closingRef.current = true;
    const backdropExit = backdropRef.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], leaving);
    exit.finished.catch(() => {}).finally(() => {
      closingRef.current = false;
      if (useAppStore.getState().detailTask?.id === closingId) {
        closeDetailPanel();
      } else {
        // Another issue opened on the way out: this panel stays, showing it.
        exit.cancel();
        backdropExit?.cancel();
      }
    });
  }, [closeDetailPanel, handleTitleBlur, handleSaveDescription]);

  closePanelRef.current = () => {
    closePanel();
    // Whatever field had focus, leaving saves what it holds, as clicking outside does.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  // Comment handlers — delegate to the store so the board badge refreshes.
  const handleCommentCreated = useCallback(
    async (payload: { author: string; text: string; type: Comment['type']; parentId?: string }) => {
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

  const handleRequestChanges = useCallback(
    (text: string) => useTaskRunStore.getState().requestChanges(activeSpaceId, detailTask?.id ?? '', text),
    [activeSpaceId, detailTask?.id],
  );

  const handleAnswerQuestion = useCallback(
    async (commentId: string, text: string) => {
      if (!detailTask) return;
      await answerQuestion(detailTask.id, commentId, text);
    },
    [detailTask, answerQuestion],
  );

  const handleCopyKey = useCallback(async (key: string) => {
    try {
      await copyToClipboard(key);
      setIsCopied(true);
      showToast(`${key} copied to clipboard`, 'success');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('Failed to copy', 'error');
    }
  }, [showToast]);

  const handleCopyLink = useCallback(async (key: string) => {
    try {
      await copyToClipboard(`${window.location.origin}${window.location.pathname}?issue=${key}`);
      showToast('Link copied to clipboard', 'success');
    } catch {
      showToast('Failed to copy', 'error');
    }
  }, [showToast]);

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

  // Kept up to date by the store while the panel is open, loaded on the board or not.
  const issue: Task = detailTask;
  const column = issue.category;
  const isEpic = issue.type === 'epic';
  const parentIssue = parentIssueOf(issue);
  const epics = allEpics.filter((epic) => epic.id !== issue.id);
  const comments = detailTask.comments ?? [];
  const hasOpenQuestion = comments.some((c) => c.type === 'question' && !c.resolved);
  const canRequestChanges = !!taskRunView
    && detailLoaded
    && column !== 'todo'
    && ['failed', 'stopped', 'done'].includes(taskRunView.status)
    && !hasOpenQuestion
    && detailTask?.assigned === taskRunView.cliTool
    && agentIsOn(activeSpace, taskRunView.cliTool as ModelCliTool);
  const saveIssue = (patch: UpdateTaskPayload) => {
    if (detailLoaded) void updateTask(issue.id, patch);
  };

  // ── Shared sub-elements ──────────────────────────────────────────────────

  const closeButton = (
    <button
      onClick={closePanel}
      aria-label="Close issue detail"
      className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:bg-surface-variant hover:text-text-primary focus:outline-hidden focus:ring-2 focus:ring-primary active:scale-[0.90] transition-ui duration-fast ease-default flex-shrink-0"
    >
      <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
        close
      </span>
    </button>
  );

  // ── Two-column centered modal ────────────────────────────────────────────
  // Left (flex-1): title, description, comments.
  // Right (w-[280px], elevated): ID, type, assigned, attachments, timestamps.

  return (
    <>
      {/* Backdrop */}
      <div ref={backdropRef} className="fixed inset-0 z-[105] bg-black/30 dark:bg-black/72 animate-backdrop-in" aria-hidden="true" onClick={closePanel} />

      {/* Centering wrapper */}
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
        {/* ── Outer bezel shell — gradient ring creates the machined-hardware frame ── */}
        <div ref={shellRef} className="pointer-events-auto w-full max-w-[1200px] h-[min(90vh,840px)] flex flex-col p-[2px] rounded-[18px] bg-gradient-to-b from-black/[0.07] to-transparent dark:from-white/[0.10] dark:to-white/[0.03] shadow-[0_56px_140px_rgba(0,0,0,0.22)] dark:shadow-[0_56px_140px_rgba(0,0,0,0.55)] animate-scale-in">
          {/* ── Inner content card ─────────────────────────────────────────────────── */}
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Issue detail"
            tabIndex={-1}
            className="outline-none flex-1 min-h-0 flex flex-col bg-surface rounded-modal overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
          {/* ── Header ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2.5 h-13 px-6 border-b border-border/40 flex-shrink-0 bg-surface-elevated/10">
            {issue.key && (
              <>
                <button
                  type="button"
                  onClick={() => handleCopyKey(issue.key!)}
                  aria-label={`Copy key ${issue.key}`}
                  title="Copy key"
                  data-testid="detail-key"
                  className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-text-secondary bg-surface-variant/80 px-2 py-1 rounded-md flex-shrink-0 border border-border/40 hover:text-text-primary focus:outline-hidden focus:ring-2 focus:ring-primary transition-colors duration-fast"
                >
                  {issue.key}
                  <span className="material-symbols-outlined text-[13px] leading-none" aria-hidden="true">{isCopied ? 'check' : 'content_copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyLink(issue.key!)}
                  aria-label="Copy link to this issue"
                  title="Copy link"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-text-primary focus:outline-hidden focus:ring-2 focus:ring-primary transition-colors duration-fast flex-shrink-0"
                >
                  <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">link</span>
                </button>
              </>
            )}
            <div className="flex-1" />
            {detailTask.createdAt && (
              <time
                dateTime={detailTask.createdAt}
                title={`Created: ${formatTimestamp(detailTask.createdAt)}${detailTask.updatedAt && detailTask.updatedAt !== detailTask.createdAt ? `\nUpdated: ${formatTimestamp(detailTask.updatedAt)}` : ''}`}
                className="text-[11px] text-text-tertiary cursor-default hidden sm:block"
              >
                Created {formatRelativeTime(detailTask.createdAt)}
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
                className={`flex-1 py-2.5 text-xs font-medium capitalize transition-ui duration-fast ease-default focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
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
            <div className={`min-w-0 overflow-y-auto px-4 md:px-14 pt-5 md:pt-7 pb-8 flex flex-col gap-6 md:flex-1 ${mobileTab === 'content' ? 'flex-1' : 'hidden md:flex'}`}>
              {/* Title — textarea wraps long titles instead of truncating */}
              <div>
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
                aria-label="Issue title"
                readOnly={!canEdit || !detailLoaded}
                className="w-full bg-transparent border-b border-transparent hover:border-border/40 focus:border-primary/50 text-[26px] font-semibold text-text-primary placeholder:text-text-tertiary/50 focus:outline-none leading-snug pb-1 min-h-[2rem] resize-none overflow-y-hidden disabled:opacity-40 disabled:cursor-not-allowed transition-[border-color] duration-fast ease-default"
                placeholder="Issue title"
              />
              {detailFailed && (
                <p role="alert" className="mt-1 text-xs text-error">
                  This issue could not be loaded, so it cannot be edited yet. Trying again…
                </p>
              )}
              </div>

              {column && !isEpic && <TaskRunPanel task={issue} column={column} spaceId={activeSpaceId} />}

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="detail-description" className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">
                  Description
                </label>
                <textarea
                  id="detail-description"
                  ref={descTextareaRef}
                  value={localDescription}
                  onChange={(e) => setLocalDescription(e.target.value)}
                  onBlur={handleSaveDescription}
                  readOnly={!canEdit || !descriptionReady}
                  aria-busy={!descriptionReady}
                  rows={1}
                  className={`w-full px-0 py-0 bg-transparent border-b border-transparent hover:border-border/25 focus:border-primary/35 font-sans text-[14px] text-text-secondary leading-relaxed placeholder:text-text-tertiary/40 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed resize-none [overflow-y:hidden] min-h-[1.5rem] transition-[border-color] duration-fast ease-default ${descriptionReady ? '' : 'opacity-60 cursor-progress'}`}
                  placeholder={descriptionReady ? 'Add a description…' : 'Loading…'}
                />
              </div>

              <ChildIssues key={issue.id} task={issue} spaceId={activeSpaceId} readOnly={!detailLoaded} />

              {/* Comments and history */}
              <div className="border-t border-border/30 pt-4">
                <div role="tablist" aria-label="Issue activity" className="flex gap-4 border-b border-border/40 mb-4">
                  {(['comments', 'history'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={activityTab === tab}
                      onClick={() => setActivityTab(tab)}
                      data-testid={`activity-tab-${tab}`}
                      className={`py-1.5 text-sm capitalize border-b-2 -mb-px transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        activityTab === tab
                          ? 'border-primary text-primary font-semibold'
                          : 'border-transparent text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {tab}
                      {tab === 'comments' && comments.length > 0 && <span className="ml-1.5 text-xs font-normal text-text-secondary">{comments.length}</span>}
                    </button>
                  ))}
                </div>
                {activityTab === 'history' ? (
                  <IssueHistory spaceId={activeSpaceId} taskId={detailTask.id} version={`${issue.updatedAt}|${issue.category}`} />
                ) : (
              <div data-testid="comments-panel">
                {!detailLoaded ? <p className="text-[12px] text-text-disabled italic">Loading…</p> : <CommentsSection
                  spaceId={activeSpaceId}
                  taskId={detailTask.id}
                  comments={comments}
                  onCommentCreated={handleCommentCreated}
                  onCommentUpdated={handleCommentUpdated}
                  onAnswerQuestion={handleAnswerQuestion}
                  onRequestChanges={canRequestChanges ? handleRequestChanges : undefined}
                />}
              </div>
                )}
              </div>
            </div>

            {/* ── RIGHT: metadata sidebar ────────────────────────────── */}
            <div className={`flex-shrink-0 border-border/40 bg-surface-elevated/25 overflow-y-auto px-4 pt-3 pb-6 flex flex-col md:w-[300px] md:border-l ${mobileTab === 'details' ? 'flex-1' : 'hidden md:flex'}`}>

              {/* A viewer sees every field and can change none, but can open the attachments below. */}
              <fieldset disabled={!canEdit || !detailLoaded} className="contents">
              {/* Status */}
              <div className={SIDE_FIELD}>
                <label htmlFor="detail-status" className={SIDE_LABEL}>Status</label>
                <select
                  id="detail-status"
                  value={issue.statusId ?? ''}
                  onChange={(e) => { if (detailLoaded) void moveTask(issue.id, e.target.value); }}
                  className={DETAIL_FIELD_CLASS}
                >
                  {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {/* Priority */}
              <div className={SIDE_FIELD}>
                <label htmlFor="detail-priority" className={SIDE_LABEL}>Priority</label>
                <select
                  id="detail-priority"
                  value={issue.priority ?? 'medium'}
                  onChange={(e) => saveIssue({ priority: e.target.value as Priority })}
                  className={DETAIL_FIELD_CLASS}
                >
                  {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>

              {/* Type */}
              <div className={SIDE_FIELD}>
                <label htmlFor="detail-type" className={SIDE_LABEL}>Type</label>
                <select
                  id="detail-type"
                  value={issue.type}
                  onChange={(e) => saveIssue({ type: e.target.value as TaskType })}
                  className={DETAIL_FIELD_CLASS}
                >
                  {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>

              {/* Assignee */}
              <div className={SIDE_FIELD}>
                <label htmlFor="detail-assigned" className={SIDE_LABEL}>Assignee</label>
                <AssigneeSelect
                  id="detail-assigned"
                  value={localAssigned}
                  onChange={handleAssignedChange}
                  className={DETAIL_FIELD_CLASS}
                />
              </div>

              {/* Epic, or the issue this is a sub-task of */}
              {!isEpic && parentIssue !== undefined && (parentIssue ? (
                <div className={SIDE_FIELD}>
                  <span className={SIDE_LABEL}>Sub-task of</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openDetailPanel({ type: 'chore', createdAt: '', updatedAt: '', ...parentIssue })}
                      data-testid="parent-link"
                      className="flex-1 min-w-0 text-left text-sm text-text-primary truncate hover:text-primary focus:outline-hidden focus:ring-2 focus:ring-primary rounded-sm"
                    >
                      <span className="font-mono text-xs text-text-secondary mr-1">{parentIssue.key}</span>
                      {parentIssue.title}
                    </button>
                    <button
                      type="button"
                      aria-label="Make it an issue of its own"
                      title="Make it an issue of its own"
                      onClick={() => saveIssue({ parentId: null })}
                      className="flex-shrink-0 text-text-disabled hover:text-error disabled:opacity-40 transition-colors duration-fast"
                    >
                      <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">close</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className={SIDE_FIELD}>
                  <label htmlFor="detail-epic" className={SIDE_LABEL}>Epic</label>
                  <select
                    id="detail-epic"
                    value={issue.parentId ?? ''}
                    onChange={(e) => saveIssue({ parentId: e.target.value || null })}
                    className={DETAIL_FIELD_CLASS}
                  >
                    <option value="">None</option>
                    {epics.map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}
                  </select>
                </div>
              ))}

              {/* Labels */}
              <div className={`${SIDE_FIELD} items-start`}>
                <label htmlFor="detail-labels" className={`${SIDE_LABEL} pt-2`}>Labels</label>
                <LabelsInput
                  id="detail-labels"
                  labels={issue.labels ?? []}
                  inputClassName={DETAIL_INPUT_CLASS}
                  chipsClassName="pl-3 pt-1.5"
                  onChange={(labels) => saveIssue({ labels })}
                />
              </div>

              {/* Due date */}
              <div className={SIDE_FIELD}>
                <label htmlFor="detail-due" className={`${SIDE_LABEL} ${isOverdue(issue) ? 'text-error' : ''}`}>
                  Due date{isOverdue(issue) && <span className="sr-only"> (overdue)</span>}
                </label>
                <input
                  id="detail-due"
                  type="date"
                  value={localDueDate}
                  onChange={(e) => setLocalDueDate(e.target.value)}
                  onBlur={handleDueDateBlur}
                  className={`${DETAIL_FIELD_BASE} pl-3 ${isOverdue(issue) ? 'text-error font-semibold' : 'text-text-primary'}`}
                  title={isOverdue(issue) ? 'Overdue' : undefined}
                />
              </div>

              {/* Estimate */}
              {!isEpic && (
                <div className={SIDE_FIELD}>
                  <label htmlFor="detail-estimate" className={SIDE_LABEL} title="In points">Estimate</label>
                  <input
                    id="detail-estimate"
                    type="number"
                    min={0}
                    step="any"
                    value={localEstimate}
                    onChange={(e) => setLocalEstimate(e.target.value)}
                    onBlur={handleEstimateBlur}
                    className={DETAIL_INPUT_CLASS}
                    placeholder="None"
                  />
                </div>
              )}

              {/* Depends on — QOL-3.
                  Always rendered: the field has its own "No dependencies" empty state.
                  When the issue is done it is read-only — a finished issue is not
                  waiting on anyone, but the record of what it waited for is worth reading. */}
              <div className="mt-2 pt-3 border-t border-border/30">
                <DependsOnSection
                  spaceId={activeSpaceId}
                  taskId={detailTask.id}
                  dependsOn={localDependsOn}
                  disabled={column === 'done' || !detailLoaded}
                  loading={!detailLoaded}
                  onUpdated={(newDeps) => {
                    setLocalDependsOn(newDeps);
                    // Refresh board so isBlocked is recalculated for all tasks
                    useAppStore.getState().loadBoard();
                  }}
                />
              </div>
              </fieldset>

              {/* Attachments */}
              {detailTask.attachments && detailTask.attachments.length > 0 && (
                <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-border/30" data-testid="attachments-section">
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
                            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface/50 border border-border/35 hover:bg-surface-variant hover:border-primary/30 hover:translate-x-0.5 focus:outline-hidden focus:ring-2 focus:ring-primary transition-ui duration-fast ease-default group"
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
                            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface/50 border border-border/35 hover:bg-surface-variant hover:border-primary/30 hover:translate-x-0.5 focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-wait transition-ui duration-fast ease-default text-left group"
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
