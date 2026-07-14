import type { BoardTasks } from '@/types';
import { COLUMNS } from '@/constants/columns';

/**
 * Distinct, sorted arc labels present on the loaded board tasks.
 *
 * The client already holds every task in the Zustand store, so the arc
 * suggestions are derived locally — no dedicated endpoint needed.
 */
export function distinctArcs(tasks: BoardTasks): string[] {
  const seen = new Set<string>();
  for (const col of COLUMNS) {
    for (const t of tasks[col] ?? []) {
      if (t.arc) seen.add(t.arc);
    }
  }
  return Array.from(seen).sort();
}

/**
 * Deterministic accent colour for an arc — same arc always gets the same hue, so
 * cards in the same storyline read as a group at a glance. Full Tailwind class
 * strings (not interpolated) so the JIT compiler keeps them, mirroring the
 * avatar-gradient approach in TaskCard. Error red is intentionally excluded to
 * avoid clashing with the bug/error semantic colour.
 */
const ARC_COLORS: string[] = [
  'bg-violet-500/10 text-violet-300',
  'bg-sky-500/10 text-sky-300',
  'bg-emerald-500/10 text-emerald-300',
  'bg-amber-500/10 text-amber-300',
  'bg-pink-500/10 text-pink-300',
  'bg-blue-500/10 text-blue-300',
  'bg-teal-500/10 text-teal-300',
  'bg-fuchsia-500/10 text-fuchsia-300',
];

/** Tailwind `bg`+`text` classes for an arc's tinted strip (stable per label). */
export function arcColor(arc: string): string {
  let hash = 0;
  for (let i = 0; i < arc.length; i++) hash = arc.charCodeAt(i) + ((hash << 5) - hash);
  return ARC_COLORS[Math.abs(hash) % ARC_COLORS.length];
}
