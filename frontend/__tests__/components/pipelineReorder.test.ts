/**
 * Unit tests for pipelineReorder.ts pure helpers.
 * Coverage target: ≥ 95%.
 * T-004: extract pure pipeline reorder helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  reorderStages,
  remapCheckpointKeys,
  checkpointsToIndices,
  generateRowKey,
} from '../../src/components/modals/pipelineReorder';

// ---------------------------------------------------------------------------
// reorderStages
// ---------------------------------------------------------------------------

describe('reorderStages', () => {
  it('moves an item forward (index 0 → 2)', () => {
    const result = reorderStages(['a', 'b', 'c', 'd'], 0, 2);
    expect(result).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item backward (index 3 → 1)', () => {
    const result = reorderStages(['a', 'b', 'c', 'd'], 3, 1);
    expect(result).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns the same reference when fromIndex === toIndex (no-op)', () => {
    const items = ['a', 'b', 'c'];
    const result = reorderStages(items, 1, 1);
    expect(result).toBe(items);
  });

  it('returns the same reference when fromIndex is negative (out of range)', () => {
    const items = ['a', 'b', 'c'];
    const result = reorderStages(items, -1, 0);
    expect(result).toBe(items);
  });

  it('returns the same reference when toIndex is negative (out of range)', () => {
    const items = ['a', 'b', 'c'];
    const result = reorderStages(items, 0, -1);
    expect(result).toBe(items);
  });

  it('returns the same reference when fromIndex >= items.length (out of range)', () => {
    const items = ['a', 'b', 'c'];
    const result = reorderStages(items, 5, 0);
    expect(result).toBe(items);
  });

  it('returns the same reference when toIndex >= items.length (out of range)', () => {
    const items = ['a', 'b', 'c'];
    const result = reorderStages(items, 0, 5);
    expect(result).toBe(items);
  });

  it('returns the same reference for an empty array', () => {
    const items: string[] = [];
    const result = reorderStages(items, 0, 0);
    expect(result).toBe(items);
  });

  it('does not mutate the original array', () => {
    const items = ['a', 'b', 'c'];
    const original = [...items];
    reorderStages(items, 0, 2);
    expect(items).toEqual(original);
  });

  it('handles a 2-element array swap (forward)', () => {
    expect(reorderStages(['a', 'b'], 0, 1)).toEqual(['b', 'a']);
  });

  it('handles a 2-element array swap (backward)', () => {
    expect(reorderStages(['a', 'b'], 1, 0)).toEqual(['b', 'a']);
  });

  it('preserves duplicate values with distinct positions', () => {
    // Two identical stage IDs — the items array preserves structural order.
    const result = reorderStages(['dev', 'dev', 'qa'], 0, 2);
    expect(result).toEqual(['dev', 'qa', 'dev']);
  });

  it('works with a single-element array (no-op regardless of same index)', () => {
    const items = ['only'];
    expect(reorderStages(items, 0, 0)).toBe(items);
  });
});

// ---------------------------------------------------------------------------
// remapCheckpointKeys
// ---------------------------------------------------------------------------

describe('remapCheckpointKeys', () => {
  it('returns an equal set (pass-through)', () => {
    const ck = new Set(['key-a', 'key-b', 'key-c']);
    const result = remapCheckpointKeys(ck);
    expect(result).toEqual(ck);
  });

  it('returns a NEW Set instance (not the same reference)', () => {
    const ck = new Set(['key-a']);
    const result = remapCheckpointKeys(ck);
    expect(result).not.toBe(ck);
  });

  it('handles an empty set', () => {
    const result = remapCheckpointKeys(new Set());
    expect(result.size).toBe(0);
  });

  it('mutations to the returned set do not affect the original', () => {
    const ck = new Set(['key-a', 'key-b']);
    const result = remapCheckpointKeys(ck);
    result.add('key-new');
    expect(ck.has('key-new')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkpointsToIndices
// ---------------------------------------------------------------------------

describe('checkpointsToIndices', () => {
  const keys = ['k0', 'k1', 'k2', 'k3'];

  it('converts key-based checkpoints to sorted indices', () => {
    const checkpoints = new Set(['k1', 'k3']);
    expect(checkpointsToIndices(keys, checkpoints)).toEqual([1, 3]);
  });

  it('returns empty array when no checkpoints active', () => {
    expect(checkpointsToIndices(keys, new Set())).toEqual([]);
  });

  it('returns all indices when all stages have checkpoints', () => {
    const checkpoints = new Set(['k0', 'k1', 'k2', 'k3']);
    expect(checkpointsToIndices(keys, checkpoints)).toEqual([0, 1, 2, 3]);
  });

  it('returns indices in positional order (not insertion order)', () => {
    // Add in reverse to ensure result is always sorted by position.
    const checkpoints = new Set(['k3', 'k1', 'k0']);
    expect(checkpointsToIndices(keys, checkpoints)).toEqual([0, 1, 3]);
  });

  it('ignores unknown keys gracefully (no-op)', () => {
    const checkpoints = new Set(['k1', 'ghost-key']);
    expect(checkpointsToIndices(keys, checkpoints)).toEqual([1]);
  });

  it('returns empty array for empty stageKeys', () => {
    expect(checkpointsToIndices([], new Set(['k0']))).toEqual([]);
  });

  it('handles duplicate stage IDs with distinct keys correctly', () => {
    // Two developer-agent rows with different row keys.
    const dupKeys = ['dev-key-1', 'dev-key-2', 'qa-key'];
    // Checkpoint on the second developer-agent only.
    const checkpoints = new Set(['dev-key-2']);
    expect(checkpointsToIndices(dupKeys, checkpoints)).toEqual([1]);
  });

  it('checkpoint follows stage after reorder (key-stable semantics)', () => {
    // Before reorder: ['k0', 'k1', 'k2'] — checkpoint on k1 (index 1)
    // After reorder (move k1 to position 0): ['k1', 'k0', 'k2']
    const reorderedKeys = ['k1', 'k0', 'k2'];
    const checkpoints = new Set(['k1']);
    // The checkpoint should now report index 0 (k1 moved to position 0).
    expect(checkpointsToIndices(reorderedKeys, checkpoints)).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// generateRowKey
// ---------------------------------------------------------------------------

describe('generateRowKey', () => {
  it('returns a non-empty string', () => {
    const key = generateRowKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('returns distinct keys on successive calls', () => {
    const keys = Array.from({ length: 100 }, () => generateRowKey());
    const unique = new Set(keys);
    expect(unique.size).toBe(100);
  });
});
