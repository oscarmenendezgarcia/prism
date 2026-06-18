import type { BoardTasks } from '@/types';

/**
 * Distinct, sorted arc labels present on the loaded board tasks.
 *
 * The client already holds every task in the Zustand store, so the arc
 * suggestions are derived locally — no dedicated endpoint needed.
 */
export function distinctArcs(tasks: BoardTasks): string[] {
  const seen = new Set<string>();
  for (const col of ['todo', 'in-progress', 'done'] as const) {
    for (const t of tasks[col] ?? []) {
      if (t.arc) seen.add(t.arc);
    }
  }
  return Array.from(seen).sort();
}
