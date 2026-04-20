/**
 * Auto-task Modal — AI-powered task generator dialog.
 *
 * Layout (inside shared <Modal>):
 *   Header: auto_awesome icon + "Auto-task" title + X close button
 *   Subtitle
 *   Textarea (autofocused, min-height 100px)
 *   Selectors row: Space pill + Column pill
 *   Footer: "AI-powered by Claude" attribution + "Generate tasks" button
 *
 * States:
 *   idle      — default, textarea enabled
 *   loading   — button "Generating...", textarea disabled, aria-busy
 *   error     — error message below textarea, button "Try again"
 *   success   — modal closes, toast "N tasks created"
 *
 * Mobile (<600px): full-screen, border-radius 20px 20px 0 0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
} from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';
import { generateAutoTasks, confirmAutoTasks, runTagger } from '@/api/client';
import type { Column, Task } from '@/types';

type Mode = 'generate' | 'autotag';
type Step = 'form' | 'review';

interface AutoTaskModalProps {
  open: boolean;
  onClose: () => void;
}

const COLUMN_LABELS: Record<Column, string> = {
  'todo':        'Todo',
  'in-progress': 'In Progress',
  'done':        'Done',
};

const COLUMNS: Column[] = ['todo', 'in-progress', 'done'];

export function AutoTaskModal({ open, onClose }: AutoTaskModalProps) {
  const spaces             = useAppStore((s) => s.spaces);
  const activeSpaceId      = useAppStore((s) => s.activeSpaceId);
  const loadBoard          = useAppStore((s) => s.loadBoard);
  const startTagger        = useAppStore((s) => s.startTagger);
  const setSuggestions     = useAppStore((s) => s.setSuggestions);
  const setTaggerError     = useAppStore((s) => s.setTaggerError);

  const [mode,         setMode]         = useState<Mode>('generate');
  const [step,         setStep]         = useState<Step>('form');
  const [prompt,       setPrompt]       = useState('');
  const [spaceId,      setSpaceId]      = useState(activeSpaceId);
  const [column,       setColumn]       = useState<Column>('todo');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync spaceId when active space changes
  useEffect(() => {
    if (!loading) setSpaceId(activeSpaceId);
  }, [activeSpaceId, loading]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setMode('generate');
      setStep('form');
      setPrompt('');
      setError(null);
      setLoading(false);
      setColumn('todo');
      setSpaceId(activeSpaceId);
      setPendingTasks([]);
    }
  }, [open, activeSpaceId]);

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError('Please describe what you need.');
      textareaRef.current?.focus();
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const result = await generateAutoTasks(spaceId, trimmed, column, true);
      setPendingTasks(result.tasks);
      setStep('review');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AutoTaskModal] generate failed:', message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [prompt, spaceId, column]);

  const handleConfirm = useCallback(async () => {
    if (pendingTasks.length === 0) return;
    setError(null);
    setLoading(true);
    try {
      const result = await confirmAutoTasks(spaceId, pendingTasks, column);
      await loadBoard();
      useAppStore.getState().showToast(
        `${result.tasksCreated} task${result.tasksCreated === 1 ? '' : 's'} created`,
        'success'
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pendingTasks, spaceId, column, loadBoard, onClose]);

  const handleAutoTag = useCallback(async () => {
    setError(null);
    setLoading(true);
    startTagger();
    try {
      const result = await runTagger(spaceId, { improveDescriptions: false });
      setSuggestions(result);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Auto-tag failed';
      setTaggerError(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [spaceId, startTagger, setSuggestions, setTaggerError, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter submits
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleGenerate();
    }
  }, [handleGenerate]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelId="autotask-modal-title"
      className="max-w-[520px]"
    >
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined icon-filled text-primary text-[20px] leading-none"
            aria-hidden="true"
          >
            auto_awesome
          </span>
          <ModalTitle id="autotask-modal-title">AI Actions</ModalTitle>
        </div>
      </ModalHeader>

      <ModalBody>
        {/* Mode toggle */}
        <div className="flex gap-1 p-1 rounded-lg bg-surface-variant border border-border mb-4" role="tablist">
          {(['generate', 'autotag'] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              disabled={loading}
              onClick={() => { setMode(m); setError(null); }}
              className={[
                'flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[13px] font-medium transition-colors',
                'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                mode === m
                  ? 'bg-surface text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              <span className="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">
                {m === 'generate' ? 'auto_awesome' : 'auto_fix_high'}
              </span>
              {m === 'generate' ? 'Generate tasks' : 'Auto-tag'}
            </button>
          ))}
        </div>

        {mode === 'generate' ? (
          step === 'form' ? (
            <form
              id="autotask-form"
              aria-busy={loading}
              onSubmit={(e) => { e.preventDefault(); handleGenerate(); }}
              className="flex flex-col gap-4"
            >
              <p className="text-[13px] text-text-secondary">
                Describe what you need and AI will generate tasks for you.
              </p>

              <div className="flex flex-col gap-1">
                <textarea
                  ref={textareaRef}
                  id="autotask-prompt"
                  aria-label="Describe the work"
                  disabled={loading}
                  value={prompt}
                  onChange={(e) => { setPrompt(e.target.value); setError(null); }}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. Build a user authentication system with login, register and password reset."
                  rows={4}
                  className={[
                    'w-full resize-y rounded-lg px-3 py-3 text-sm text-text-primary',
                    'bg-surface-variant border placeholder:text-text-disabled',
                    'focus:outline-hidden focus:ring-[3px]',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    'min-h-[100px]',
                    error
                      ? 'border-error focus:border-error focus:ring-error/[0.12]'
                      : 'border-border focus:border-primary/50 focus:ring-primary/[0.12]',
                  ].join(' ')}
                />
                {error && (
                  <p role="alert" className="text-[12px] text-error flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">error</span>
                    {error}
                  </p>
                )}
              </div>

              {/* Selectors row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-text-secondary shrink-0">Add to:</span>

                <div className="relative">
                  <select
                    id="autotask-space"
                    aria-label="Target space"
                    disabled={loading}
                    value={spaceId}
                    onChange={(e) => setSpaceId(e.target.value)}
                    className={[
                      'appearance-none h-7 pl-3 pr-7 rounded-full text-[12px] font-medium',
                      'bg-surface-variant border border-border text-text-primary',
                      'focus:outline-hidden focus:ring-[2px] focus:ring-primary/[0.20]',
                      'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
                    ].join(' ')}
                  >
                    {spaces.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined text-[14px] leading-none pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true">expand_more</span>
                </div>

                <div className="relative">
                  <select
                    id="autotask-column"
                    aria-label="Target column"
                    disabled={loading}
                    value={column}
                    onChange={(e) => setColumn(e.target.value as Column)}
                    className={[
                      'appearance-none h-7 pl-3 pr-7 rounded-full text-[12px] font-medium',
                      'bg-surface-variant border border-border text-text-primary',
                      'focus:outline-hidden focus:ring-[2px] focus:ring-primary/[0.20]',
                      'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
                    ].join(' ')}
                  >
                    {COLUMNS.map((col) => (
                      <option key={col} value={col}>{COLUMN_LABELS[col]}</option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined text-[14px] leading-none pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true">expand_more</span>
                </div>
              </div>
            </form>
          ) : (
            /* Review step */
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-text-secondary">
                  Review and remove any tasks before creating them.
                </p>
                <button
                  onClick={() => { setStep('form'); setError(null); }}
                  className="text-[12px] text-text-secondary hover:text-text-primary flex items-center gap-0.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">arrow_back</span>
                  Edit prompt
                </button>
              </div>

              <ul className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto pr-0.5">
                {pendingTasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-surface-variant border border-border group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary font-medium leading-tight truncate">{task.title}</p>
                      {task.description && (
                        <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-2">{task.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setPendingTasks((prev) => prev.filter((t) => t.id !== task.id))}
                      aria-label={`Remove "${task.title}"`}
                      className="shrink-0 mt-0.5 text-text-disabled hover:text-error transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">close</span>
                    </button>
                  </li>
                ))}
              </ul>

              {pendingTasks.length === 0 && (
                <p className="text-[13px] text-text-secondary text-center py-4">All tasks removed.</p>
              )}

              {error && (
                <p role="alert" className="text-[12px] text-error flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">error</span>
                  {error}
                </p>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-4" aria-busy={loading}>
            <p className="text-[13px] text-text-secondary">
              AI will classify all cards in the space as <strong className="text-text-primary font-medium">feature</strong>, <strong className="text-text-primary font-medium">bug</strong>, <strong className="text-text-primary font-medium">tech-debt</strong>, or <strong className="text-text-primary font-medium">chore</strong>. You'll review suggestions before anything changes.
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] text-text-secondary shrink-0">Space:</span>
              <div className="relative">
                <select
                  aria-label="Target space"
                  disabled={loading}
                  value={spaceId}
                  onChange={(e) => setSpaceId(e.target.value)}
                  className={[
                    'appearance-none h-7 pl-3 pr-7 rounded-full text-[12px] font-medium',
                    'bg-surface-variant border border-border text-text-primary',
                    'focus:outline-hidden focus:ring-[2px] focus:ring-primary/[0.20]',
                    'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
                  ].join(' ')}
                >
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <span className="material-symbols-outlined text-[14px] leading-none pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true">expand_more</span>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-[12px] text-error flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">error</span>
                {error}
              </p>
            )}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
{mode === 'generate' ? (
          step === 'form' ? (
            <Button
              type="submit"
              form="autotask-form"
              variant="primary"
              disabled={loading}
              aria-busy={loading}
              className="h-9 text-sm"
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined text-[16px] leading-none animate-spin" aria-hidden="true">progress_activity</span>
                  Generating...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined icon-filled text-[16px] leading-none" aria-hidden="true">auto_awesome</span>
                  {error ? 'Try again' : 'Generate tasks'}
                </>
              )}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={loading || pendingTasks.length === 0}
              aria-busy={loading}
              className="h-9 text-sm"
              onClick={handleConfirm}
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined text-[16px] leading-none animate-spin" aria-hidden="true">progress_activity</span>
                  Creating...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">check</span>
                  Create {pendingTasks.length} task{pendingTasks.length === 1 ? '' : 's'}
                </>
              )}
            </Button>
          )
        ) : (
          <Button
            variant="primary"
            disabled={loading}
            aria-busy={loading}
            className="h-9 text-sm"
            onClick={handleAutoTag}
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined text-[16px] leading-none animate-spin" aria-hidden="true">progress_activity</span>
                Tagging...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">auto_fix_high</span>
                {error ? 'Try again' : 'Auto-tag tasks'}
              </>
            )}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
