/**
 * Direct task runs: which agent will run each card, and how its latest run is going.
 */

import { create } from 'zustand';
import * as api from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';
import type { AgentChoice, TaskRunView } from '@/types';

const CHOICE_STORAGE_KEY = 'prism:agent-choice';

function readSavedChoice(): AgentChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICE_STORAGE_KEY) ?? 'null');
    if (saved && typeof saved.cliTool === 'string') return saved;
  } catch { /* corrupt or unavailable — use the default */ }
  return { cliTool: 'claude' };
}

interface TaskRunState {
  /** Latest run of each task in the active space, by task ID. */
  views: Record<string, TaskRunView>;
  /** The agent new runs use. The last one chosen, across cards and sessions. */
  choice: AgentChoice;
  /** Tasks with an action in flight, to disable their buttons. */
  busyTaskIds: Set<string>;

  setChoice: (choice: AgentChoice) => void;
  load: (spaceId: string) => Promise<void>;
  start: (spaceId: string, taskId: string) => Promise<void>;
  stop: (spaceId: string, taskId: string) => Promise<void>;
  retry: (spaceId: string, taskId: string) => Promise<void>;
  requestChanges: (spaceId: string, taskId: string, text: string) => Promise<void>;
  close: (spaceId: string, taskId: string) => Promise<void>;
}

export const useTaskRunStore = create<TaskRunState>((set, get) => {
  /** Run an action on a task, then refresh. Errors become toasts and are rethrown. */
  async function act(spaceId: string, taskId: string, action: () => Promise<unknown>): Promise<void> {
    if (get().busyTaskIds.has(taskId)) return;
    set((s) => ({ busyTaskIds: new Set(s.busyTaskIds).add(taskId) }));
    try {
      await action();
      await Promise.all([get().load(spaceId), useAppStore.getState().loadBoard()]);
    } catch (err) {
      useAppStore.getState().showToast((err as Error).message, 'error');
      throw err;
    } finally {
      set((s) => {
        const busyTaskIds = new Set(s.busyTaskIds);
        busyTaskIds.delete(taskId);
        return { busyTaskIds };
      });
    }
  }

  const runIdOf = (taskId: string): string => {
    const view = get().views[taskId];
    if (!view) throw new Error('This task has no run.');
    return view.runId;
  };

  return {
    views: {},
    choice: readSavedChoice(),
    busyTaskIds: new Set(),

    setChoice: (choice) => {
      set({ choice });
      try {
        localStorage.setItem(CHOICE_STORAGE_KEY, JSON.stringify(choice));
      } catch { /* the choice just will not survive a reload */ }
    },

    load: async (spaceId) => {
      try {
        const views = await api.getTaskRuns(spaceId);
        // The user may have switched spaces while the request was in flight.
        if (useAppStore.getState().activeSpaceId !== spaceId) return;
        // A run that changes state moved its card or left comments: refresh the board too.
        const previous = get().views;
        const changed = Object.values(views).some((v) => previous[v.taskId] && previous[v.taskId].status !== v.status);
        set({ views });
        if (changed) void useAppStore.getState().loadBoard();
      } catch {
        // Polling failure — the next tick retries.
      }
    },

    start: (spaceId, taskId) => act(spaceId, taskId, () => api.startTaskRun(spaceId, taskId, get().choice)),
    stop: (spaceId, taskId) => act(spaceId, taskId, () => api.stopRun(runIdOf(taskId))),
    retry: (spaceId, taskId) => act(spaceId, taskId, () => api.resumeRun(runIdOf(taskId))),
    requestChanges: (spaceId, taskId, text) => act(spaceId, taskId, () => api.requestTaskChanges(spaceId, taskId, text)),
    close: (spaceId, taskId) => act(spaceId, taskId, () => api.closeTaskRun(spaceId, taskId)),
  };
});
