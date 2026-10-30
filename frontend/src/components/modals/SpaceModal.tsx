/**
 * Space modal — handles both 'create' and 'rename' modes.
 * ADR-002: replaces #space-modal-overlay and the openSpaceModal() logic in spaces.js.
 */

import React, { useState, useEffect, useRef } from 'react';
import { EMPTY_SPACE_HOOKS, readSpaceHooks, SpaceHookSection } from '@/components/runs/SpaceHookSection';
import { updateSpaceHooks, validateDirectory } from '@/api/client';
import type { SpaceHooks } from '@/types';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';

const SPACE_NAME_MAX    = 100;
const TITLE_ID          = 'space-modal-title';

const inputClass =
  'w-full bg-surface border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-fast text-sm';

export function SpaceModal() {
  const spaceModal = useAppStore((s) => s.spaceModal);
  const closeModal = useAppStore((s) => s.closeSpaceModal);
  const createSpace = useAppStore((s) => s.createSpace);
  const renameSpace = useAppStore((s) => s.renameSpace);

  const [name, setName] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hooks, setHooks] = useState<SpaceHooks>(EMPTY_SPACE_HOOKS);
  const [hookError, setHookError] = useState('');
  const [directoryError, setDirectoryError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const isOpen = spaceModal?.open ?? false;
  const mode = spaceModal?.mode ?? 'create';
  const space = spaceModal?.space;

  // Pre-fill and reset on open
  useEffect(() => {
    if (isOpen) {
      setHookError('');
      setHooks(readSpaceHooks(space?.hooks));
      setDirectoryError('');
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

    let wd = workingDirectory.trim() || undefined;
    setSubmitting(true);
    try {
      setDirectoryError('');
      if (wd) {
        try {
          const checked = await validateDirectory(wd);
          if (!checked.isGitRepo) {
            setDirectoryError('This folder is not a git repository. Agents need one to work in.');
            return;
          }
          wd = checked.path;
        } catch (err) {
          setDirectoryError((err as Error).message);
          return;
        }
      }
      if (mode === 'create') {
        await createSpace(trimmed, wd);
        closeModal();
      } else if (mode === 'rename' && space) {
        const { spaces, loadSpaces } = useAppStore.getState();
        const saved = readSpaceHooks((spaces.find((sp) => sp.id === space.id) ?? space).hooks);
        const next: SpaceHooks = { checkCommand: hooks.checkCommand?.trim() || null, autoPr: hooks.autoPr };
        setHookError('');
        // First, because the server refuses it while an agent runs, and then nothing else
        // has changed and the form stays open with the reason.
        if (next.checkCommand !== saved.checkCommand || next.autoPr !== saved.autoPr) {
          try {
            await updateSpaceHooks(space.id, next);
          } catch (err) {
            setHookError((err as Error).message);
            return;
          }
          // Now, in case the rest fails: the board and a reopened form must show them.
          await loadSpaces();
        }
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
          {mode === 'create' ? 'New Space' : 'Edit Space'}
        </ModalTitle>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          {mode === 'create'
            ? 'Give your space a name to organize your tasks.'
            : 'Change the settings of this space.'}
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
            className={`${inputClass} ${directoryError ? 'border-error ring-1 ring-error' : ''}`}
            type="text"
            placeholder="e.g. /Users/me/projects/my-app"
            value={workingDirectory}
            onChange={(e) => { setWorkingDirectory(e.target.value); setDirectoryError(''); }}
            autoComplete="off"
            aria-describedby="space-wd-hint"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
          />
          {directoryError && (
            <span className="text-xs text-error mt-1 block" role="alert">{directoryError}</span>
          )}
          <span id="space-wd-hint" className="text-xs text-text-disabled mt-1 block">
            A git repository on the server. Agents work in it when they run tasks in this space.
          </span>
        </div>

        {mode === 'rename' && space && (
          <>
            <SpaceHookSection hooks={hooks} onChange={setHooks} />
            {hookError && <span className="text-xs text-error block" role="alert">{hookError}</span>}
          </>
        )}
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
