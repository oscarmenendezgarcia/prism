/**
 * What GET /spaces/:id/board answers, for a board with these cards and nothing beyond them.
 */

import type { BoardEpic, BoardResponse, BoardTasks } from '../../src/types';

export function boardAnswer(
  tasks: BoardTasks,
  { epics = [], etag = null, totals = {} }: { epics?: BoardEpic[]; etag?: string | null; totals?: Record<string, number> } = {},
): { data: BoardResponse; etag: string | null } {
  return {
    data: {
      columns: Object.fromEntries(Object.entries(tasks).map(([id, list]) => [id, { tasks: list, total: totals[id] ?? list.length }])),
      epics,
    },
    etag,
  };
}
