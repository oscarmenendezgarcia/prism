/**
 * Wraps the editable stage list in a DnD context.
 *
 * - DndContext configures PointerSensor (5 px activation distance) and
 *   KeyboardSensor (sortableKeyboardCoordinates) so pointer clicks on the
 *   checkbox / remove button do not accidentally start a drag.
 * - SortableContext provides vertical-list ordering strategy.
 * - Focus is restored to the dragged row's handle after every drop.
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
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
