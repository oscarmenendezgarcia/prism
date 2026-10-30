/**
 * Task runs: how the latest run of each card is going.
 */

import { create } from 'zustand';
import * as api from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';
import type { HarnessInfo, ModelCliTool, Space, TaskRunView } from '@/types';
import { AGENT_NAMES, agentIsOn } from '@/utils/agents';

/** Why this agent cannot run here, or null when it can. */
export function runProblem(agent: ModelCliTool, space: Space | undefined, harnesses: HarnessInfo[] | null): string | null {
  if (!agentIsOn(space, agent)) return `${AGENT_NAMES[agent]} is off in this space`;
  if (harnesses?.find((h) => h.cliTool === agent)?.available === false) return `${AGENT_NAMES[agent]} is not installed`;
  return null;
}

interface TaskRunState {
  /** Latest run of each task in the active space, by task ID. */
  views: Record<string, TaskRunView>;
  /** The agent new runs use. The last one chosen, across cards and sessions. */
  /** What is installed on this machine. Null until the first answer. */
  harnesses: HarnessInfo[] | null;
  /** Tasks with an action in flight, to disable their buttons. */
  busyTaskIds: Set<string>;

  loadHarnesses: () => Promise<void>;
  load: (spaceId: string) => Promise<void>;
  start: (spaceId: string, taskId: string) => Promise<void>;
  stop: (spaceId: string, taskId: string) => Promise<void>;
  retry: (spaceId: string, taskId: string) => Promise<void>;
  requestChanges: (spaceId: string, taskId: string, text: string) => Promise<void>;
  close: (spaceId: string, taskId: string) => Promise<void>;
  createPullRequest: (spaceId: string, taskId: string) => Promise<void>;
}

export const useTaskRunStore = create<TaskRunState>((set, get) => {
  /** Run an action on a task, then refresh. Errors become toasts and are rethrown. */
  async function act(spaceId: string, taskId: string, action: () => Promise<unknown>): Promise<void> {
    if (get().busyTaskIds.has(taskId)) {
      // A silent return would read as success, and the comment form clears its draft on it.
      const err = new Error('Another action on this task is still running.');
      useAppStore.getState().showToast(err.message, 'error');
      throw err;
    }
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
    harnesses: null,
    busyTaskIds: new Set(),

    loadHarnesses: async () => {
      try {
        set({ harnesses: (await api.getHarnesses()).harnesses });
      } catch {
        // Unknown availability must not block a run. The server reports a missing binary.
      }
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

    start: (spaceId, taskId) => act(spaceId, taskId, () => api.startTaskRun(spaceId, taskId)),
    stop: (spaceId, taskId) => act(spaceId, taskId, () => api.stopRun(runIdOf(taskId))),
    retry: (spaceId, taskId) => act(spaceId, taskId, () => api.resumeRun(runIdOf(taskId))),
    requestChanges: (spaceId, taskId, text) => act(spaceId, taskId, () => api.requestTaskChanges(spaceId, taskId, text)),
    close: (spaceId, taskId) => act(spaceId, taskId, () => api.closeTaskRun(spaceId, taskId)),
    createPullRequest: (spaceId, taskId) => act(spaceId, taskId, () => api.createTaskPullRequest(spaceId, taskId)),
  };
});
