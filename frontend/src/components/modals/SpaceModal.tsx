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

const inputClass =
  'w-full px-3 py-2 border border-border rounded-md text-sm text-text-primary bg-surface-variant placeholder:text-text-disabled focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/40 transition-colors duration-150 h-12';

export function SpaceModal() {
  const spaceModal = useAppStore((s) => s.spaceModal);
  const closeModal = useAppStore((s) => s.closeSpaceModal);
  const createSpace = useAppStore((s) => s.createSpace);
  const renameSpace = useAppStore((s) => s.renameSpace);

  const [name, setName] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
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
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await createSpace(trimmed, wd);
        closeModal();
      } else if (mode === 'rename' && space) {
        await renameSpace(space.id, trimmed, wd ?? '');
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
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="secondary" onClick={closeModal}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={submitting}
          onClick={handleSubmit}
        >
          {submitting ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
