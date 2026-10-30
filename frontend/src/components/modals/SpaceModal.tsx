/**
 * Space modal — handles both 'create' and 'rename' modes.
 * ADR-002: replaces #space-modal-overlay and the openSpaceModal() logic in spaces.js.
 */

import React, { useState, useEffect, useRef } from 'react';
import { EMPTY_SPACE_HOOKS, readSpaceHooks, SpaceHookSection } from '@/components/runs/SpaceHookSection';
import { getTasks, updateSpaceHooks, updateSpaceStatuses, validateDirectory } from '@/api/client';
import type { SpaceHooks, Status } from '@/types';
import { defaultFinishStatus } from '@/utils/issues';
import { StatusesEditor, StatusRow, toStatusRows } from './StatusesEditor';
import type { ApiError } from '@/api/client';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';

const SPACE_NAME_MAX    = 100;
const TITLE_ID          = 'space-modal-title';
const KEY_PATTERN       = /^[A-Z][A-Z0-9]{1,9}$/;

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
  const [key, setKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusError, setStatusError] = useState('');
  const [finishStatus, setFinishStatus] = useState<string | undefined>();

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
      setKey(mode === 'rename' && space ? (space.key ?? '') : '');
      setKeyError('');
      setRows(toStatusRows(space?.statuses));
      setMoves({});
      setCounts({});
      setStatusError('');
      setFinishStatus(space?.finishStatusId);
      if (mode === 'rename' && space) {
        getTasks(space.id)
          .then((board) => setCounts(Object.fromEntries(Object.entries(board).map(([id, list]) => [id, list.length]))))
          .catch(() => {}); // The server still refuses to lose issues.
      }
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, mode, space]);

  // From the store, not from when the form opened: a refused save may have saved a part.
  const currentSpace = useAppStore((s) => s.spaces.find((sp) => sp.id === space?.id)) ?? space;
  const savedStatuses: Status[] = currentSpace?.statuses ?? [];
  const removed = savedStatuses.filter((s) => !rows.some((r) => r.id === s.id));
  const finishable = rows.flatMap((r) => (r.id && r.category !== 'todo' ? [{ id: r.id, name: r.name }] : []));
  const shownFinish = finishable.some((s) => s.id === finishStatus) ? finishStatus : defaultFinishStatus(rows);

  function handleRemoveStatus(row: StatusRow) {
    setRows(rows.filter((r) => r.rowKey !== row.rowKey));
    setStatusError('');
    if (row.id && row.id === finishStatus) setFinishStatus(undefined);
    // Issues cannot go to a status that is also going.
    setMoves(Object.fromEntries(Object.entries(moves).filter(([, target]) => target !== row.id)));
  }

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

    const trimmedKey = key.trim();
    if (mode === 'rename' && currentSpace?.key && !trimmedKey) {
      setKeyError('A space needs a key.');
      return;
    }
    if (trimmedKey && !KEY_PATTERN.test(trimmedKey)) {
      setKeyError('A key has 2 to 10 capital letters or digits and starts with a letter.');
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
        await createSpace(trimmed, wd, trimmedKey || undefined);
        closeModal();
      } else if (mode === 'rename' && space) {
        const { spaces, loadSpaces } = useAppStore.getState();
        const saved = readSpaceHooks((spaces.find((sp) => sp.id === space.id) ?? space).hooks);
        const next: SpaceHooks = { checkCommand: hooks.checkCommand?.trim() || null, autoPr: hooks.autoPr };
        setHookError('');
        setStatusError('');
        setKeyError('');
        // First, because the server refuses these while an agent runs, and then nothing
        // else has changed and the form stays open with the reason.
        const nextStatuses = rows.map(({ id, name: statusName, category }) => ({ ...(id && { id }), name: statusName.trim(), category }));
        if (JSON.stringify(nextStatuses) !== JSON.stringify(savedStatuses)) {
          try {
            const updated = await updateSpaceStatuses(space.id, nextStatuses, moves);
            // Saved now, whatever happens next: saving again must not create them again.
            setRows(toStatusRows(updated.statuses));
            setMoves({});
          } catch (err) {
            setStatusError((err as Error).message);
            return;
          }
          await loadSpaces();
        }
        const finishChanged = !!finishStatus && finishStatus !== useAppStore.getState().spaces.find((sp) => sp.id === space.id)?.finishStatusId;
        if (finishChanged) next.finishStatus = finishStatus;
        if (finishChanged || next.checkCommand !== saved.checkCommand || next.autoPr !== saved.autoPr) {
          try {
            await updateSpaceHooks(space.id, next);
          } catch (err) {
            setHookError((err as Error).message);
            return;
          }
          // Now, in case the rest fails: the board and a reopened form must show them.
          await loadSpaces();
        }
        await renameSpace(space.id, trimmed, wd ?? '', trimmedKey || undefined);
        closeModal();
      }
    } catch (err) {
      if ((err as ApiError).code === 'DUPLICATE_KEY') setKeyError((err as Error).message);
      else setError((err as Error).message || 'Failed to save space');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={isOpen} onClose={closeModal} labelId={TITLE_ID}>
      <ModalHeader onClose={closeModal}>
        <ModalTitle id={TITLE_ID}>
          {mode === 'create' ? 'New space' : `${space?.name ?? 'Space'} settings`}
        </ModalTitle>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          {mode === 'create'
            ? 'Give your space a name to organize your issues.'
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
          <label htmlFor="space-key-input" className="block text-sm font-medium text-text-primary mb-1.5">
            Key {mode === 'create' && <span className="text-text-disabled font-normal">(optional)</span>}
          </label>
          <input
            id="space-key-input"
            className={`${inputClass} font-mono max-w-[160px] ${keyError ? 'border-error ring-1 ring-error' : ''}`}
            type="text"
            maxLength={10}
            placeholder="WEB"
            value={key}
            onChange={(e) => { setKey(e.target.value.toUpperCase()); setKeyError(''); }}
            autoComplete="off"
            aria-describedby="space-key-hint"
          />
          {keyError && <span className="text-xs text-error mt-1 block" role="alert">{keyError}</span>}
          <span id="space-key-hint" className="text-xs text-text-disabled mt-1 block">
            Issues are numbered {key.trim() || 'WEB'}-1, {key.trim() || 'WEB'}-2… Old links keep working if you change it.
          </span>
        </div>

        {mode === 'rename' && space && (
          <div>
            <StatusesEditor
              rows={rows}
              onChange={(next) => { setRows(next); setStatusError(''); }}
              counts={counts}
              removed={removed}
              moves={moves}
              onRemove={handleRemoveStatus}
              onMoveChange={(statusId, targetId) => setMoves({ ...moves, [statusId]: targetId })}
            />
            {statusError && <span className="text-xs text-error mt-1 block" role="alert">{statusError}</span>}
          </div>
        )}

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
            A git repository on the server. Agents work in it when they run issues in this space.
          </span>
        </div>

        {mode === 'rename' && space && (
          <>
            <SpaceHookSection
              hooks={hooks}
              onChange={setHooks}
              statuses={finishable}
              hasUnsavedStatuses={rows.some((r) => !r.id)}
              finishStatus={shownFinish}
              onFinishStatusChange={setFinishStatus}
            />
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
