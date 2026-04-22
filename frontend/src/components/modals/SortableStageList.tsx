/**
 * Wraps the editable stage list in a DnD context.
 *
 * - DndContext configures PointerSensor (5 px activation distance) and
 *   KeyboardSensor (sortableKeyboardCoordinates) so pointer clicks on the
 *   checkbox / remove button do not accidentally start a drag.
 * - SortableContext provides vertical-list ordering strategy.
 * - Focus is restored to the dragged row's handle after every drop.
 * - BUG-001 fix: Escape key interception during active keyboard drag prevents
 *   the Modal's Escape-to-close handler from firing before @dnd-kit can cancel.
 * - BUG-002 fix: Custom accessibility.announcements provide human-readable stage
 *   names instead of raw UUID row-instance keys.
 *
 * T-006: add SortableStageList with DnD context.
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useAppStore } from '@/stores/useAppStore';
import { SortableStageItem } from './SortableStageItem';
import { reorderStages, remapCheckpointKeys } from './pipelineReorder';
import type { PipelineStage } from '@/types';
import type { AgentInfo } from '@/types';

export interface SortableStageListProps {
  stages: PipelineStage[];
  /** Ordered stable row-instance IDs — parallel to `stages`. */
  stageKeys: string[];
  /** Row-key-keyed checkpoint set (Set<string>, not positional Set<number>). */
  checkpoints: Set<string>;
  availableAgents: AgentInfo[];
  /** When true, the "Pause before this stage" checkbox is hidden on every row. */
  useOrchestrator: boolean;
  /**
   * Called when the user completes a drag-drop reorder.
   * Receives the new stage order, the new key order, and the remapped
   * checkpoint set (unchanged for Set<string>-based checkpoints).
   */
  onReorder: (
    nextStages: PipelineStage[],
    nextKeys: string[],
    nextCheckpoints: Set<string>,
  ) => void;
  onRemove: (index: number) => void;
  onToggleCheckpoint: (rowKey: string) => void;
}

export function SortableStageList({
  stages,
  stageKeys,
  checkpoints,
  availableAgents,
  useOrchestrator,
  onReorder,
  onRemove,
  onToggleCheckpoint,
}: SortableStageListProps) {
  /** ID of the stage row currently being dragged; null when idle. */
  const [activeId, setActiveId] = useState<string | null>(null);
  /**
   * The last active ID is kept after a drop so the useEffect can focus
   * the handle of the row that was just placed.
   */
  const lastActiveIdRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require ≥ 5 px of movement before a drag starts.
      // This lets single-click events on the checkbox and remove button
      // pass through without activating the drag gesture.
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // After a drag ends (activeId goes null → focus the handle of the moved row).
  useEffect(() => {
    if (activeId !== null || lastActiveIdRef.current === null) return;
    const handle = document.querySelector<HTMLButtonElement>(
      `[data-dnd-handle-key="${lastActiveIdRef.current}"]`,
    );
    handle?.focus();
    // Clear so subsequent renders don't re-focus.
    lastActiveIdRef.current = null;
  }, [activeId]);

  // BUG-001: Prevent Escape from closing the Modal while a keyboard drag is active.
  //
  // @dnd-kit's KeyboardSensor registers its cancel handler on `window` in the
  // capture phase — it fires at step (1) of the propagation chain. The Modal's
  // Escape-to-close handler is on `document` in the bubble phase — step (3).
  // Our interceptor sits on `document` in the capture phase — step (2). This
  // lets @dnd-kit cancel the drag first, then we stop propagation so the Modal
  // handler never sees the event.
  //
  // Using a closure that doesn't reference `activeId` is intentional: the
  // listener is registered/unregistered by the effect lifecycle. When `activeId`
  // is non-null the listener is present; when null it is removed.
  useEffect(() => {
    if (!activeId) return;
    function stopEscCapture(e: KeyboardEvent) {
      if (e.key === 'Escape') e.stopPropagation();
    }
    document.addEventListener('keydown', stopEscCapture, { capture: true });
    return () => document.removeEventListener('keydown', stopEscCapture, { capture: true });
  }, [activeId]);

  function handleDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    setActiveId(id);
    lastActiveIdRef.current = id;
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const fromIndex = stageKeys.indexOf(String(active.id));
    const toIndex   = stageKeys.indexOf(String(over.id));

    if (fromIndex === -1 || toIndex === -1) {
      console.error('PipelineReorder: drag ended with no valid drop target', {
        active,
        over,
      });
      useAppStore.getState().showToast('Reorder failed', 'error');
      return;
    }

    const nextStages      = reorderStages(stages, fromIndex, toIndex);
    const nextKeys        = reorderStages(stageKeys, fromIndex, toIndex);
    const nextCheckpoints = remapCheckpointKeys(checkpoints);
    onReorder(nextStages, nextKeys, nextCheckpoints);
  }

  function handleDragCancel() {
    // @dnd-kit restores the row to its original position automatically.
    // We only need to clear the active state.
    setActiveId(null);
  }

  // BUG-002: Build a row-key → human-readable display name lookup so that
  // the DndContext accessibility.announcements can use stage names instead
  // of raw UUID keys. Re-computed whenever stageKeys, stages, or agents change.
  const rowKeyToName: Record<string, string> = {};
  stageKeys.forEach((key, i) => {
    rowKeyToName[key] =
      availableAgents.find((a) => a.id === stages[i])?.displayName ?? stages[i];
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      // BUG-002: custom announcements replace default UUID-based text with
      // human-readable stage names for screen-reader users.
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => {
            const name = rowKeyToName[String(active.id)] ?? String(active.id);
            return `Picked up stage ${name}. Use arrow keys to move. Space to drop. Escape to cancel.`;
          },
          onDragOver: ({ active, over }) => {
            if (!over) return undefined;
            const name = rowKeyToName[String(active.id)] ?? String(active.id);
            const pos  = stageKeys.indexOf(String(over.id)) + 1;
            return `Stage ${name} moved to position ${pos} of ${stageKeys.length}.`;
          },
          onDragEnd: ({ active, over }) => {
            const name = rowKeyToName[String(active.id)] ?? String(active.id);
            if (!over) return `Stage ${name} dropped.`;
            const pos = stageKeys.indexOf(String(over.id)) + 1;
            return pos > 0
              ? `Stage ${name} dropped at position ${pos}.`
              : `Stage ${name} dropped.`;
          },
          onDragCancel: ({ active }) => {
            const name = rowKeyToName[String(active.id)] ?? String(active.id);
            return `Cancelled. Stage ${name} returned to its original position.`;
          },
        },
      }}
    >
      <SortableContext items={stageKeys} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-2">
          {stages.map((stage, i) => {
            const key         = stageKeys[i];
            const displayName = availableAgents.find((a) => a.id === stage)?.displayName ?? stage;
            return (
              <SortableStageItem
                key={key}
                id={key}
                index={i + 1}
                stage={stage}
                displayName={displayName}
                checkpointActive={checkpoints.has(key)}
                showCheckpoint={!useOrchestrator}
                onRemove={() => onRemove(i)}
                onToggleCheckpoint={() => onToggleCheckpoint(key)}
              />
            );
          })}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
