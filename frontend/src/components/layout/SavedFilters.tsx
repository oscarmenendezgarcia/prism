/**
 * Filters kept for later: choose one to apply it, and save, rename or delete them.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { IssueFilters, SavedFilter } from '@/types';
import * as api from '@/api/client';
import { Button } from '@/components/shared/Button';
import { Modal, ModalTitle } from '@/components/shared/Modal';
import { useAppStore } from '@/stores/useAppStore';
import { useCanEdit } from '@/stores/useAuthStore';
import { cleanFilters, hasFilters } from '@/utils/issueFilters';

const NAME_MAX = 80;

/** The same filters, whatever order their values were chosen in. */
function sameFilters(a: IssueFilters, b: IssueFilters): boolean {
  const canonical = (filters: IssueFilters) => JSON.stringify(
    Object.entries(cleanFilters(filters))
      .map(([field, value]) => [field, Array.isArray(value) ? [...value].sort() : value])
      .sort(([x], [y]) => String(x).localeCompare(String(y))),
  );
  return canonical(a) === canonical(b);
}

/** A name, and for a new one who can see it. */
function SaveDialog({ title, initialName, initialShared, showShared, busy, error, onSave, onClose }: {
  title: string;
  initialName: string;
  initialShared: boolean;
  showShared: boolean;
  busy: boolean;
  error: string | null;
  onSave: (name: string, shared: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [shared, setShared] = useState(initialShared);
  const labelId = useId();
  return (
    <Modal open onClose={onClose} labelId={labelId} maxWidth="max-w-sm">
      <div className="px-4 pt-4"><ModalTitle id={labelId}>{title}</ModalTitle></div>
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim(), shared);
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
          Name
          <input
            autoFocus
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            data-testid="saved-filter-name"
            className="h-9 px-2 rounded-md border border-border bg-surface text-sm font-normal text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </label>
        {showShared && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-medium text-text-secondary">Who can see it</legend>
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input type="radio" name="saved-filter-who" checked={!shared} onChange={() => setShared(false)} className="accent-primary" />
              Only me
            </label>
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input type="radio" name="saved-filter-who" checked={shared} onChange={() => setShared(true)} data-testid="saved-filter-team" className="accent-primary" />
              The whole team
            </label>
            {shared && <p className="text-xs text-text-secondary">Only you or an admin can change it.</p>}
          </fieldset>
        )}
        {error && <p role="alert" className="text-xs text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" disabled={busy || !name.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

export function SavedFilters({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const activeSpaceId = useAppStore((s) => s.activeSpaceId);
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const showToast = useAppStore((s) => s.showToast);
  const canEdit = useCanEdit();
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ renaming?: SavedFilter } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const spaceRef = useRef(activeSpaceId);
  spaceRef.current = activeSpaceId;

  const requests = useRef(0);

  const load = useCallback(async () => {
    const request = ++requests.current;
    const asked = spaceRef.current;
    try {
      const found = await api.getSavedFilters(asked);
      // Only the last one asked: an earlier answer could bring back what was just deleted.
      if (request !== requests.current) return;
      setSaved(found);
      setLoadState('loaded');
    } catch {
      if (request === requests.current) setLoadState('failed');
    }
  }, []);

  useEffect(() => { setSaved([]); setLoadState('loading'); setAppliedId(null); void load(); }, [activeSpaceId, load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onOpenChange(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, load, onOpenChange]);

  const closeDialog = () => {
    setDialog(null);
    setError(null);
    buttonRef.current?.focus();
  };

  const onSave = async (name: string, shared: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const { renaming } = dialog ?? {};
      if (renaming) await api.updateSavedFilter(activeSpaceId, renaming.id, renaming.mine ? { name, shared } : { name });
      else await api.createSavedFilter(activeSpaceId, { name, shared, filters });
      closeDialog();
      showToast(dialog?.renaming ? 'Filter renamed' : 'Filter saved');
      await load();
    } catch (err) {
      // In the dialog, which stays open with what was typed.
      setError((err as Error).message);
      void load();
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (one: SavedFilter) => {
    setBusy(true);
    try {
      await api.deleteSavedFilter(activeSpaceId, one.id);
      showToast('Filter deleted');
      setDeleting(null);
      buttonRef.current?.focus();
      await load();
    } catch (err) {
      showToast((err as Error).message, 'error');
      await load();
    } finally {
      setBusy(false);
    }
  };

  // Which one was chosen, if two say the same. Otherwise the first that says this.
  const matching = saved.filter((one) => sameFilters(one.filters, filters));
  const current = matching.find((one) => one.id === appliedId) ?? matching[0];
  const filtering = hasFilters(filters);

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { onOpenChange(!open); setDeleting(null); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={current ? `Saved filters: ${current.name}` : 'Saved filters'}
        data-testid="saved-filters-button"
        className={`flex items-center gap-1 h-7 px-2 rounded-md border text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors duration-fast ${
          current
            ? 'bg-primary/15 border-primary/40 text-primary'
            : 'bg-surface border-border text-text-secondary hover:border-primary/30 hover:text-text-primary'
        }`}
      >
        <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">bookmark</span>
        <span className="hidden sm:inline max-w-[9rem] truncate">{current?.name ?? 'Saved'}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Saved filters"
          data-testid="saved-filters-panel"
          className="fixed sm:absolute inset-x-2 sm:inset-x-auto top-[9.5rem] sm:top-9 sm:left-0 z-40 sm:w-72 max-h-[calc(100vh-10rem)] sm:max-h-[70vh] overflow-y-auto p-1 rounded-lg border border-border bg-surface-elevated shadow-lg"
        >
          {saved.length === 0 && loadState !== 'loading' && (
            <p className="px-2 py-3 text-xs text-text-secondary">
              {loadState === 'failed'
                ? 'They could not be loaded.'
                : filtering ? 'None yet. Save the filters you have on.' : 'None yet. Choose some filters, then save them here.'}
            </p>
          )}
          <ul>
            {saved.map((one) => (
              <li key={one.id} data-testid="saved-filter" className="flex items-center gap-1 min-h-8 rounded hover:bg-surface-variant">
                {deleting === one.id ? (
                  <div className="flex flex-1 min-w-0 items-center gap-1 pl-2 py-1" data-testid="saved-filter-confirm">
                    <span className="flex-1 min-w-0 text-xs text-text-primary">
                      Delete “{one.name}”{one.shared ? ' for the whole team' : ''}?
                    </span>
                    <Button autoFocus variant="ghost" size="sm" onClick={() => { setDeleting(null); buttonRef.current?.focus(); }}>Keep</Button>
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => void onDelete(one)}>Delete</Button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { setFilters(one.filters); setAppliedId(one.id); onOpenChange(false); buttonRef.current?.focus(); }}
                      className={`flex flex-1 min-w-0 items-center gap-1.5 h-8 pl-2 text-left text-xs rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${one === current ? 'font-medium text-primary' : 'text-text-primary'}`}
                    >
                      <span className="truncate">{one.name}</span>
                      {one.shared && <span className="flex-shrink-0 text-[11px] text-text-secondary">Team</span>}
                    </button>
                    {one.canChange && (
                      <>
                        <button
                          type="button"
                          aria-label={`Rename ${one.name}`}
                          onClick={() => { onOpenChange(false); setError(null); setDialog({ renaming: one }); }}
                          className="flex items-center justify-center w-7 h-7 flex-shrink-0 rounded text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        >
                          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">edit</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${one.name}`}
                          onClick={() => setDeleting(one.id)}
                          className="flex items-center justify-center w-7 h-7 flex-shrink-0 rounded text-text-secondary hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        >
                          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">delete</span>
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {filtering && (
            <button
              type="button"
              onClick={() => { onOpenChange(false); setError(null); setDialog({}); }}
              data-testid="save-filter"
              className="flex items-center gap-1.5 w-full h-8 mt-1 px-2 rounded border-t border-border-subtle text-left text-xs font-medium text-primary hover:bg-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">add</span>
              Save current filters
            </button>
          )}
        </div>
      )}

      {dialog && (
        <SaveDialog
          title={dialog.renaming ? 'Edit filter' : 'Save filter'}
          initialName={dialog.renaming?.name ?? ''}
          initialShared={dialog.renaming?.shared ?? false}
          showShared={canEdit && (!dialog.renaming || dialog.renaming.mine)}
          busy={busy}
          error={error}
          onSave={(name, shared) => void onSave(name, shared)}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
