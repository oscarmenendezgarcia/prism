/**
 * Space modal — handles both 'create' and 'rename' modes.
 * ADR-002: replaces #space-modal-overlay and the openSpaceModal() logic in spaces.js.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';

const SPACE_NAME_MAX = 100;
const TITLE_ID = 'space-modal-title';

const DEFAULT_STAGES = ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'];
const STAGE_OPTIONS  = DEFAULT_STAGES;

const inputClass =
  'w-full bg-surface border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-fast text-sm';

export function SpaceModal() {
  const spaceModal = useAppStore((s) => s.spaceModal);
  const closeModal = useAppStore((s) => s.closeSpaceModal);
  const createSpace = useAppStore((s) => s.createSpace);
  const renameSpace = useAppStore((s) => s.renameSpace);

  const [name, setName] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [pipeline, setPipeline] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const isOpen = spaceModal?.open ?? false;
  const mode = spaceModal?.mode ?? 'create';
  const space = spaceModal?.space;

  // Pre-fill and reset on open
  useEffect(() => {
    if (isOpen) {
      setName(mode === 'rename' && space ? space.name : '');
      setWorkingDirectory(mode === 'rename' && space ? (space.workingDirectory ?? '') : '');
      setPipeline(mode === 'rename' && space ? (space.pipeline ?? []) : []);
      setError('');
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, mode, space]);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Space name is required.');
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > SPACE_NAME_MAX) {
      setError(`Name must not exceed ${SPACE_NAME_MAX} characters.`);
      return;
    }

    const wd = workingDirectory.trim() || undefined;
    const pl = pipeline.length > 0 ? pipeline : undefined;
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await createSpace(trimmed, wd, pl);
        closeModal();
      } else if (mode === 'rename' && space) {
        await renameSpace(space.id, trimmed, wd ?? '', pl ?? []);
        closeModal();
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to save space');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={isOpen} onClose={closeModal} labelId={TITLE_ID}>
      <ModalHeader onClose={closeModal}>
        <ModalTitle id={TITLE_ID}>
          {mode === 'create' ? 'New Space' : 'Rename Space'}
        </ModalTitle>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          {mode === 'create'
            ? 'Give your space a name to organize your tasks.'
            : 'Enter a new name for this space.'}
        </p>

        <div>
          <label htmlFor="space-name-input" className="block text-sm font-medium text-text-primary mb-1.5">
            Space Name
          </label>
          <input
            id="space-name-input"
            ref={inputRef}
            className={`${inputClass} ${error ? 'border-error ring-1 ring-error' : ''}`}
            type="text"
            maxLength={SPACE_NAME_MAX}
            placeholder="e.g. Marketing, Dev, Sprint 1"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          {error && (
            <span className="text-xs text-error mt-1 block" role="alert">{error}</span>
          )}
        </div>

        <div>
          <label htmlFor="space-wd-input" className="block text-sm font-medium text-text-primary mb-1.5">
            Working Directory <span className="text-text-disabled font-normal">(optional)</span>
          </label>
          <input
            id="space-wd-input"
            className={inputClass}
            type="text"
            placeholder="e.g. /Users/me/projects/my-app"
            value={workingDirectory}
            onChange={(e) => setWorkingDirectory(e.target.value)}
            autoComplete="off"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
          />
          <span className="text-xs text-text-disabled mt-1 block">
            Used as the working directory when agents run tasks in this space.
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            Pipeline Stages <span className="text-text-disabled font-normal">(optional — defaults to full pipeline)</span>
          </label>
          <div className="flex flex-col gap-2">
            {(pipeline.length > 0 ? pipeline : []).map((stage, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className={`${inputClass} flex-1 h-10`}
                  value={stage}
                  onChange={(e) => {
                    const next = [...pipeline];
                    next[i] = e.target.value;
                    setPipeline(next);
                  }}
                >
                  {STAGE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-text-secondary hover:text-error transition-colors px-2 py-1 text-sm"
                  onClick={() => setPipeline(pipeline.filter((_, j) => j !== i))}
                  aria-label="Remove stage"
                >
                  ✕
                </button>
              </div>
            ))}
            {pipeline.length < STAGE_OPTIONS.length && (
              <button
                type="button"
                className="text-sm text-primary hover:text-primary/80 text-left transition-colors"
                onClick={() => {
                  const used = new Set(pipeline);
                  const next = STAGE_OPTIONS.find((s) => !used.has(s));
                  if (next) setPipeline([...pipeline, next]);
                }}
              >
                + Add stage
              </button>
            )}
            {pipeline.length > 0 && (
              <button
                type="button"
                className="text-xs text-text-disabled hover:text-text-secondary text-left transition-colors"
                onClick={() => setPipeline([])}
              >
                Reset to default
              </button>
            )}
          </div>
          <span className="text-xs text-text-disabled mt-1 block">
            Override the default agent pipeline for tasks in this space.
          </span>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={closeModal}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={submitting}
          onClick={handleSubmit}
        >
          {submitting ? 'Saving...' : mode === 'create' ? 'Create Space' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
