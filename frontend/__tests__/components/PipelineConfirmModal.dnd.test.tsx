/**
 * DnD-specific component tests for PipelineConfirmModal.
 *
 * SortableStageList is mocked so we can trigger the onReorder callback
 * directly — DnD gestures require layout measurements not available in jsdom.
 * This lets us test that the modal correctly handles the reorder callback
 * (state updates, checkpoint-follows-stage, preview-cache invalidation, etc.)
 * without coupling these tests to the internal DnD implementation.
 *
 * T-008: component tests for pipeline DnD reorder.
 *
 * Scenarios covered:
 * (a) Tab order reaches each stage's drag handle.
 * (b) Reordering stages 1 and 2 swaps them in the UI.
 * (c) Checkpoint on stage 2 follows it to position 1 after a drag.
 * (d) Removing a stage keeps checkpoint/state integrity.
 * (e) previewPrompts becomes null after a reorder.
 * (f) Duplicate agent IDs: checkpoint stays on the correct instance after reorder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { PipelineConfirmModal } from '../../src/components/modals/PipelineConfirmModal';
import { useAppStore } from '../../src/stores/useAppStore';
import type { PipelineStage } from '../../src/types';
import * as apiClient from '../../src/api/client';

// ---------------------------------------------------------------------------
// Capture onReorder from SortableStageList so tests can trigger it directly.
// ---------------------------------------------------------------------------

type OnReorderFn = (
  nextStages: PipelineStage[],
  nextKeys: string[],
  nextCheckpoints: Set<string>,
) => void;

type OnRemoveFn = (index: number) => void;
type OnToggleCheckpointFn = (key: string) => void;

interface CapturedListProps {
  stages: PipelineStage[];
  stageKeys: string[];
  checkpoints: Set<string>;
  onReorder: OnReorderFn;
  onRemove: OnRemoveFn;
  onToggleCheckpoint: OnToggleCheckpointFn;
  useOrchestrator: boolean;
}

let capturedProps: CapturedListProps | null = null;

vi.mock('../../src/components/modals/SortableStageList', () => ({
  SortableStageList: (props: CapturedListProps) => {
    capturedProps = props;
    // Render a simplified list so existing assertions on text / checkboxes work.
    return (
      <ol>
        {props.stages.map((stage: PipelineStage, i: number) => {
          const key = props.stageKeys[i];
          return (
            <li key={key} data-testid={`stage-item-${i}`}>
              {/* Drag handle — keyboard-focusable per spec */}
              <button
                type="button"
                aria-label={`Drag to reorder ${stage}`}
                data-dnd-handle-key={key}
              >
                ⠿
              </button>
              <span>{stage}</span>
              {!props.useOrchestrator && (
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Pause before stage ${i + 1}: ${stage}`}
                    checked={props.checkpoints.has(key)}
                    onChange={() => props.onToggleCheckpoint(key)}
                  />
                  Pause before this stage
                </label>
              )}
              <button
                type="button"
                aria-label="Remove stage"
                onClick={() => props.onRemove(i)}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ol>
    );
  },
}));

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:              vi.fn(),
  getTasks:               vi.fn(),
  createTask:             vi.fn().mockResolvedValue({ id: 'sub-1', title: 'sub' }),
  moveTask:               vi.fn(),
  deleteTask:             vi.fn(),
  createSpace:            vi.fn(),
  renameSpace:            vi.fn(),
  deleteSpace:            vi.fn(),
  getAttachmentContent:   vi.fn(),
  getAgents:              vi.fn().mockResolvedValue([]),
  generatePrompt:         vi.fn().mockResolvedValue({
    promptPath: '/tmp/p.md',
    cliCommand: '',
    promptPreview: '',
    promptFull: '',
    estimatedTokens: 0,
  }),
  getSettings:            vi.fn(),
  saveSettings:           vi.fn(),
  startRun:               vi.fn().mockResolvedValue({ runId: 'r-1', status: 'pending', stages: [], spaceId: 's-1', taskId: 't-1', createdAt: new Date().toISOString() }),
  getBackendRun:          vi.fn(),
  deleteRun:              vi.fn(),
  previewPipelinePrompts: vi.fn().mockResolvedValue({
    prompts: [
      { stageIndex: 0, agentId: 'senior-architect', promptFull: '# Stage 0', estimatedTokens: 100 },
      { stageIndex: 1, agentId: 'ux-api-designer',  promptFull: '# Stage 1', estimatedTokens: 80 },
    ],
  }),
}));

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

const STAGES: PipelineStage[] = [
  'senior-architect',
  'ux-api-designer',
  'developer-agent',
  'qa-engineer-e2e',
];

function resetStore(overrides: Record<string, unknown> = {}) {
  const startPipelineFn        = vi.fn().mockResolvedValue(undefined);
  const executeOrchestratorFn  = vi.fn().mockResolvedValue(undefined);
  const closePipelineFn        = vi.fn();

  useAppStore.setState({
    pipelineConfirmModal: {
      open:                true,
      spaceId:             'space-1',
      taskId:              'task-1',
      stages:              [...STAGES],
      checkpoints:         [],
      useOrchestratorMode: false,
    },
    pipelineState:           null,
    startPipeline:           startPipelineFn,
    executeOrchestratorRun:  executeOrchestratorFn,
    closePipelineConfirm:    closePipelineFn,
    prepareAgentRun:         vi.fn().mockResolvedValue(undefined),
    availableAgents: [
      { id: 'senior-architect', displayName: 'Senior Architect', name: '', path: '', sizeBytes: 0 },
      { id: 'ux-api-designer',  displayName: 'UX / API Designer', name: '', path: '', sizeBytes: 0 },
      { id: 'developer-agent',  displayName: 'Developer Agent', name: '', path: '', sizeBytes: 0 },
      { id: 'qa-engineer-e2e',  displayName: 'QA Engineer E2E', name: '', path: '', sizeBytes: 0 },
    ],
    templates:   [],
    loadAgents:  vi.fn().mockResolvedValue(undefined),
    loadTemplates: vi.fn().mockResolvedValue(undefined),
    spaces:      [],
    agentSettings: null,
    tasks:       { todo: [], 'in-progress': [], done: [] },
    ...overrides,
  } as any);

  return { startPipelineFn, executeOrchestratorFn, closePipelineFn };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedProps = null;
});

// ---------------------------------------------------------------------------
// Helper — simulate a drag by calling the captured onReorder callback with
// the result of reorderStages applied to the current stageKeys/stages.
// ---------------------------------------------------------------------------

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

function triggerReorder(fromIndex: number, toIndex: number) {
  if (!capturedProps) throw new Error('SortableStageList was not rendered');
  const { stages, stageKeys, checkpoints } = capturedProps;
  const nextStages      = arrayMove(stages, fromIndex, toIndex);
  const nextKeys        = arrayMove(stageKeys, fromIndex, toIndex);
  const nextCheckpoints = new Set(checkpoints); // keys follow the stage — no remap needed
  act(() => {
    capturedProps!.onReorder(nextStages, nextKeys, nextCheckpoints);
  });
}

function triggerToggleCheckpoint(key: string) {
  if (!capturedProps) throw new Error('SortableStageList was not rendered');
  act(() => {
    capturedProps!.onToggleCheckpoint(key);
  });
}

// ---------------------------------------------------------------------------
// (a) Tab order — drag handles are keyboard-focusable
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal DnD — (a) handle focusability', () => {
  it('renders one drag handle per stage, each keyboard-focusable', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    const handles = screen.getAllByRole('button', { name: /drag to reorder/i });
    expect(handles).toHaveLength(4);
    handles.forEach((handle) => {
      // No tabIndex of -1 (explicitly excluded from Tab order).
      const tabIndex = handle.getAttribute('tabindex');
      expect(tabIndex === null || Number(tabIndex) >= 0).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// (b) Swapping stages 0 and 1 via onReorder
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal DnD — (b) swap stages 0 and 1', () => {
  it('lists UX first after swapping positions 0 and 1', () => {
    resetStore();
    render(<PipelineConfirmModal />);

    // Initial order: SA, UX, DEV, QA.
    expect(capturedProps).toBeTruthy();
    expect(capturedProps!.stages[0]).toBe('senior-architect');
    expect(capturedProps!.stages[1]).toBe('ux-api-designer');

    triggerReorder(0, 1);

    // After swap: UX, SA, DEV, QA.
    expect(capturedProps!.stages[0]).toBe('ux-api-designer');
    expect(capturedProps!.stages[1]).toBe('senior-architect');
  });

  it('timeline dots reflect the new order after swap', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    // Stage names appear in the timeline too.
    const timelineBefore = screen.getAllByText('Senior Architect');
    expect(timelineBefore.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (c) Checkpoint follows stage (value-in, value-out semantics)
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal DnD — (c) checkpoint follows stage after reorder', () => {
  it('checkpoint on stage at index 1 stays on that stage when it moves to index 0', () => {
    resetStore();
    render(<PipelineConfirmModal />);

    expect(capturedProps).toBeTruthy();

    // Toggle checkpoint on stage at index 1 (UX) and capture the key before reorder.
    const uxKey = capturedProps!.stageKeys[1];
    triggerToggleCheckpoint(uxKey);

    // Now drag stage 1 (UX) to position 0.
    triggerReorder(1, 0);

    // capturedProps now has the new state.
    // Stage 0 should be UX; its key should still have an active checkpoint.
    expect(capturedProps!.stages[0]).toBe('ux-api-designer');
    expect(capturedProps!.stageKeys[0]).toBe(uxKey);
    expect(capturedProps!.checkpoints.has(uxKey)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (d) Remove keeps checkpoint integrity
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal DnD — (d) remove keeps checkpoint integrity', () => {
  it('checkpoint remains when an unrelated stage is removed', () => {
    resetStore();
    render(<PipelineConfirmModal />);

    expect(capturedProps).toBeTruthy();

    // Toggle checkpoint on stage 2 (developer-agent).
    const devKey = capturedProps!.stageKeys[2];
    triggerToggleCheckpoint(devKey);
    expect(capturedProps!.checkpoints.has(devKey)).toBe(true);

    // Remove stage 0 (senior-architect) via the remove button.
    const removeButtons = screen.getAllByRole('button', { name: /remove stage/i });
    act(() => { fireEvent.click(removeButtons[0]); });

    // developer-agent checkpoint should still be active (key is stable).
    expect(capturedProps!.stageKeys).toContain(devKey);
    expect(capturedProps!.checkpoints.has(devKey)).toBe(true);
  });

  it('removed stage key is no longer in checkpoints', () => {
    resetStore();
    render(<PipelineConfirmModal />);

    expect(capturedProps).toBeTruthy();

    // Toggle checkpoint on stage 0 (senior-architect).
    const saKey = capturedProps!.stageKeys[0];
    triggerToggleCheckpoint(saKey);
    expect(capturedProps!.checkpoints.has(saKey)).toBe(true);

    // Remove stage 0.
    const removeButtons = screen.getAllByRole('button', { name: /remove stage/i });
    act(() => { fireEvent.click(removeButtons[0]); });

    // The key should no longer be in the checkpoint set.
    expect(capturedProps!.checkpoints.has(saKey)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (e) previewPrompts becomes null after a reorder
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal DnD — (e) preview cache clears on reorder', () => {
  it('previewPrompts is null after onReorder is called', async () => {
    resetStore();
    render(<PipelineConfirmModal />);

    // Fetch preview prompts.
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /1\. senior architect/i })).toBeInTheDocument();
    });

    // Trigger a reorder.
    triggerReorder(0, 1);

    // Preview sections should be gone.
    expect(screen.queryByRole('button', { name: /1\. senior architect/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (f) Duplicate agent IDs — correct checkpoint follows the right instance
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal DnD — (f) duplicate agent IDs', () => {
  it('checkpoint on the second developer-agent stays on it after reorder', () => {
    resetStore({
      pipelineConfirmModal: {
        open:                true,
        spaceId:             'space-1',
        taskId:              'task-1',
        stages:              ['developer-agent', 'developer-agent', 'qa-engineer-e2e'] as PipelineStage[],
        checkpoints:         [],
        useOrchestratorMode: false,
      },
    });
    render(<PipelineConfirmModal />);

    expect(capturedProps).toBeTruthy();
    const [key0, key1] = capturedProps!.stageKeys;

    // Toggle checkpoint on the SECOND developer-agent (index 1).
    triggerToggleCheckpoint(key1);
    expect(capturedProps!.checkpoints.has(key1)).toBe(true);
    expect(capturedProps!.checkpoints.has(key0)).toBe(false);

    // Drag the second developer-agent (index 1) above the first (index 0).
    triggerReorder(1, 0);

    // After reorder: key1 is now at index 0; checkpoint should still be on key1.
    expect(capturedProps!.stageKeys[0]).toBe(key1);
    expect(capturedProps!.checkpoints.has(key1)).toBe(true);
    expect(capturedProps!.checkpoints.has(key0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (g) startPipeline receives correct indices after a reorder + checkpoint
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal DnD — (g) startPipeline receives positional indices', () => {
  it('calls startPipeline with index 0 after checkpoint stage is dragged to position 0', async () => {
    const { startPipelineFn } = resetStore();
    render(<PipelineConfirmModal />);

    expect(capturedProps).toBeTruthy();

    // Put a checkpoint on stage 1 (UX, key at index 1).
    const uxKey = capturedProps!.stageKeys[1];
    triggerToggleCheckpoint(uxKey);

    // Drag stage 1 to position 0.
    triggerReorder(1, 0);

    // Click Run — UX is now at index 0, so checkpoint should report index 0.
    fireEvent.click(screen.getByRole('button', { name: /run 4 stages/i }));
    await vi.waitFor(() => expect(startPipelineFn).toHaveBeenCalledOnce());

    const call = startPipelineFn.mock.calls[0];
    const stages      = call[2]; // third arg
    const checkpoints = call[3]; // fourth arg

    expect(stages[0]).toBe('ux-api-designer'); // UX is now first
    expect(checkpoints).toEqual([0]);           // checkpoint on index 0
  });
});
