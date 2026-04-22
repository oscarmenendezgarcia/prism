/**
 * Pure helper functions for pipeline stage drag-and-drop reordering.
 *
 * No React imports. No module-level state. Every export is a pure function.
 * T-004: extract pure pipeline reorder helpers.
 */

/**
 * Move item at `fromIndex` to `toIndex`, shifting other items aside.
 * Returns the original array (same reference) when:
 *   - fromIndex === toIndex (no-op)
 *   - either index is out of bounds
 *   - items is empty
 */
export function reorderStages<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (items.length === 0) return items;
  if (fromIndex === toIndex) return items;
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const result = [...items];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

/**
 * No-op pass-through for row-key-based checkpoint sets.
 *
 * Because checkpoints are keyed by stable row instance IDs (not positional
 * indices), set membership is invariant across reorders — no remapping is
 * needed. This function exists for symmetry with the legacy Set<number>
 * implementation so future refactors can swap without updating call sites.
 */
export function remapCheckpointKeys(checkpoints: Set<string>): Set<string> {
  return new Set(checkpoints);
}

/**
 * Translate the row-key-based checkpoint set to the positional `number[]`
 * the backend expects. Called only at `handleRun()` time.
 *
 * @param stageKeys - Ordered list of stable row instance IDs, parallel to the stages array.
 * @param checkpoints - Set of row keys that have an active checkpoint.
 * @returns Sorted array of 0-based stage indices where checkpoints are active.
 */
export function checkpointsToIndices(
  stageKeys: string[],
  checkpoints: Set<string>,
): number[] {
  return stageKeys
    .map((key, i): number => (checkpoints.has(key) ? i : -1))
    .filter((i): i is number => i !== -1);
}

/**
 * Generate a stable row key for a single stage instance.
 * Uses `crypto.randomUUID()` so duplicate stage IDs in the same pipeline
 * each receive a distinct key.
 */
export function generateRowKey(): string {
  return crypto.randomUUID();
}
