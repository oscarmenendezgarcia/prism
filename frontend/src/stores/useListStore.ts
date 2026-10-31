/**
 * The rows of the list. The server filters and orders, so the browser only holds the pages
 * around what is on screen, and asks for them again when something may have changed.
 */

import { create } from 'zustand';
import * as api from '@/api/client';
import type { BulkChanges, Task } from '@/types';
import { useAppStore } from '@/stores/useAppStore';

export const LIST_PAGE = 100;
/** What can be changed at once, which is what the server allows. */
export const BULK_MAX = 500;
/** Pages kept on either side of those on screen. */
const PAGES_KEPT = 2;

interface ListState {
  /** By position in the list. What is not here is not loaded. */
  rows: Record<number, Task>;
  /** How many issues match, once it is known. */
  total: number | null;
  failed: boolean;
  /** Ids of the selected issues. */
  selected: ReadonlySet<string>;
  /** Show these positions: loads what is missing of them. */
  showRange: (first: number, last: number) => void;
  /** The filters or the order changed: what comes next replaces what there is. */
  restart: () => void;
  /** Ask again for what is on screen. */
  refresh: () => Promise<void>;
  toggleSelected: (id: string) => void;
  /** Select all that match, up to what can be changed at once. */
  selectAll: () => Promise<void>;
  clearSelection: () => void;
  /** Change the selected issues. Whether it worked; if not, it has said why. */
  changeSelected: (changes: BulkChanges) => Promise<boolean>;
}

/** Goes up after a write: what was asked for before it says nothing of what there is now. */
let generation = 0;

const queryKey = () => {
  const { activeSpaceId, filters, listSort } = useAppStore.getState();
  return JSON.stringify([activeSpaceId, filters, listSort, generation]);
};

let etags = new Map<number, string | null>();
let loadedSpace: string | null = null;
let shownPages: [number, number] = [0, 0];
/** Waiting for the first answer of a new query, which then replaces all the rows. */
let replacing = false;
const inFlight = new Map<string, Promise<void>>();

export const useListStore = create<ListState>((set, get) => {
  async function loadPage(page: number): Promise<void> {
    const key = queryKey();
    const flight = `${key}|${page}`;
    const running = inFlight.get(flight);
    if (running) return running;
    const { activeSpaceId, filters, listSort } = useAppStore.getState();
    const request = (async () => {
      try {
        const fresh = await api.getIssues(activeSpaceId, {
          filters, sort: listSort, offset: page * LIST_PAGE, limit: LIST_PAGE, etag: etags.get(page) ?? null,
        });
        if (queryKey() !== key) return;
        if (fresh) {
          etags.set(page, fresh.etag);
          const { tasks, total } = fresh.data;
          const rows: Record<number, Task> = {};
          const [firstShown, lastShown] = shownPages;
          if (!replacing) {
            for (const [position, task] of Object.entries(get().rows)) {
              const at = Number(position);
              const itsPage = Math.floor(at / LIST_PAGE);
              const near = itsPage >= firstShown - PAGES_KEPT && itsPage <= lastShown + PAGES_KEPT;
              if (near && itsPage !== page && at < total) rows[at] = task;
            }
          }
          tasks.forEach((task, i) => { rows[page * LIST_PAGE + i] = task; });
          replacing = false;
          // Without its rows, a page has to come back whole.
          const held = new Set(Object.keys(rows).map((at) => Math.floor(Number(at) / LIST_PAGE)));
          for (const known of etags.keys()) {
            if (known !== page && !held.has(known)) etags.delete(known);
          }
          set({ rows, total, failed: false });
        } else if (get().failed) {
          set({ failed: false });
        }
      } catch (err) {
        if (queryKey() !== key) return;
        // What is on screen is of another query, and saying nothing would pass it off as this one.
        if (replacing || get().total === null) set({ rows: {}, total: null, failed: true });
        // Otherwise it is only out of date, and the next poll tries again.
        else console.warn('[list]', (err as Error).message);
      } finally {
        inFlight.delete(flight);
      }
    })();
    inFlight.set(flight, request);
    return request;
  }

  return {
    rows: {},
    total: null,
    failed: false,
    selected: new Set<string>(),

    showRange: (first, last) => {
      const firstPage = Math.floor(Math.max(0, first) / LIST_PAGE);
      const lastPage = Math.floor(Math.max(0, last) / LIST_PAGE);
      shownPages = [firstPage, lastPage];
      const { rows, total } = get();
      for (let page = firstPage; page <= lastPage; page++) {
        const at = page * LIST_PAGE;
        if (total !== null && at >= total && page > 0) continue;
        if (replacing || !rows[at]) void loadPage(page);
      }
    },

    restart: () => {
      etags = new Map();
      shownPages = [0, 0];
      replacing = true;
      // Of another space, a row would open or change something that is not here.
      const { activeSpaceId } = useAppStore.getState();
      const otherSpace = loadedSpace !== null && loadedSpace !== activeSpaceId;
      loadedSpace = activeSpaceId;
      set({ selected: new Set<string>(), failed: false, ...(otherSpace && { rows: {}, total: null }) });
      void loadPage(0);
    },

    refresh: async () => {
      const [first, last] = shownPages;
      const pages: Promise<void>[] = [];
      for (let page = first; page <= last; page++) pages.push(loadPage(page));
      await Promise.all(pages);
    },

    toggleSelected: (id) => {
      const selected = new Set(get().selected);
      if (!selected.delete(id)) {
        if (selected.size >= BULK_MAX) {
          useAppStore.getState().showToast(`You can select up to ${BULK_MAX} issues at once`, 'info');
          return;
        }
        selected.add(id);
      }
      set({ selected });
    },

    selectAll: async () => {
      const { activeSpaceId, filters, listSort, showToast } = useAppStore.getState();
      const key = queryKey();
      try {
        const { ids, total } = await api.getIssueIds(activeSpaceId, { filters, sort: listSort });
        if (queryKey() !== key) return;
        set({ selected: new Set(ids) });
        if (total > ids.length) showToast(`Selected the first ${ids.length} of ${total.toLocaleString('en-US')} issues`, 'info');
      } catch (err) {
        showToast((err as Error).message, 'error');
      }
    },

    clearSelection: () => set({ selected: new Set<string>() }),

    changeSelected: async (changes) => {
      const { activeSpaceId, loadBoard, showToast } = useAppStore.getState();
      const ids = [...get().selected];
      try {
        const { updated } = await api.updateIssues(activeSpaceId, ids, changes);
        showToast(updated === 0 ? 'Nothing to change' : `${updated} ${updated === 1 ? 'issue' : 'issues'} changed`);
        // Whatever was ticked while this was on its way stays ticked.
        const left = new Set(get().selected);
        ids.forEach((id) => left.delete(id));
        set({ selected: left });
        generation += 1;
        await Promise.all([get().refresh(), loadBoard()]);
        return true;
      } catch (err) {
        const { code, details } = err as { code?: string; details?: { missing?: string[] } };
        const missing = code === 'TASK_NOT_FOUND' ? details?.missing : undefined;
        if (missing && missing.length > 0) {
          // Someone deleted them. Without this every retry would fail, over issues nobody can see.
          const left = new Set(get().selected);
          missing.forEach((id) => left.delete(id));
          set({ selected: left });
          showToast(`Nothing changed: ${missing.length} of the selected ${missing.length === 1 ? 'issue no longer exists' : 'issues no longer exist'}, and ${missing.length === 1 ? 'it was' : 'they were'} unselected`, 'error');
        } else {
          showToast((err as Error).message, 'error');
        }
        return false;
      }
    },
  };
});
