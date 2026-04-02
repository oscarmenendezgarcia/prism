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
import { generateAutoTasks } from '@/api/client';
import type { Column } from '@/types';

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
  const spaces        = useAppStore((s) => s.spaces);
  const activeSpaceId = useAppStore((s) => s.activeSpaceId);
  const loadBoard     = useAppStore((s) => s.loadBoard);

  const [prompt,   setPrompt]   = useState('');
  const [spaceId,  setSpaceId]  = useState(activeSpaceId);
  const [column,   setColumn]   = useState<Column>('todo');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync spaceId when active space changes
  useEffect(() => {
    if (!loading) setSpaceId(activeSpaceId);
  }, [activeSpaceId, loading]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setPrompt('');
      setError(null);
      setLoading(false);
      setColumn('todo');
      setSpaceId(activeSpaceId);
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
      const result = await generateAutoTasks(spaceId, trimmed, column);
      // Reload board so new tasks appear immediately
      await loadBoard();
      useAppStore.getState().showToast(
        `${result.tasksCreated} task${result.tasksCreated === 1 ? '' : 's'} created`,
        'success'
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AutoTaskModal] generate failed:', message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [prompt, spaceId, column, loadBoard, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter submits
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleGenerate();
    }
  }, [handleGenerate]);

  const activeSpace = spaces.find((s) => s.id === spaceId);

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
            className="material-symbols-outlined icon-filled text-primary"
            aria-hidden="true"
            style={{ fontSize: '20px' }}
          >
            auto_awesome
          </span>
          <ModalTitle id="autotask-modal-title">Auto-task</ModalTitle>
        </div>
      </ModalHeader>

      <ModalBody>
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
                'focus:outline-none focus:ring-[3px]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'min-h-[100px]',
                error
                  ? 'border-error focus:border-error focus:ring-error/[0.12]'
                  : 'border-border focus:border-primary/50 focus:ring-primary/[0.12]',
              ].join(' ')}
            />
            {error && (
              <p
                role="alert"
                className="text-[12px] text-error flex items-center gap-1"
              >
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '14px' }}>
                  error
                </span>
                {error}
              </p>
            )}
          </div>

          {/* Selectors row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-text-secondary shrink-0">Add to:</span>

            {/* Space selector */}
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
                  'focus:outline-none focus:ring-[2px] focus:ring-primary/[0.20]',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'cursor-pointer',
                ].join(' ')}
              >
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <span
                className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary"
                aria-hidden="true"
                style={{ fontSize: '14px' }}
              >
                expand_more
              </span>
            </div>

            {/* Column selector */}
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
                  'focus:outline-none focus:ring-[2px] focus:ring-primary/[0.20]',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'cursor-pointer',
                ].join(' ')}
              >
                {COLUMNS.map((col) => (
                  <option key={col} value={col}>{COLUMN_LABELS[col]}</option>
                ))}
              </select>
              <span
                className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary"
                aria-hidden="true"
                style={{ fontSize: '14px' }}
              >
                expand_more
              </span>
            </div>
          </div>
        </form>
      </ModalBody>

      <ModalFooter>
        <span className="flex-1 text-[12px] text-text-secondary opacity-40 flex items-center gap-1">
          <span className="material-symbols-outlined icon-filled" aria-hidden="true" style={{ fontSize: '14px' }}>
            auto_awesome
          </span>
          AI-powered by Claude
        </span>
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
              <span
                className="material-symbols-outlined animate-spin"
                aria-hidden="true"
                style={{ fontSize: '16px' }}
              >
                progress_activity
              </span>
              Generating...
            </>
          ) : (
            <>
              <span
                className="material-symbols-outlined icon-filled"
                aria-hidden="true"
                style={{ fontSize: '16px' }}
              >
                auto_awesome
              </span>
              {error ? 'Try again' : 'Generate tasks'}
            </>
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
