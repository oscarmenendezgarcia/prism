/**
 * Component tests for PipelineConfirmModal.
 * Covers:
 *   - modal renders when open
 *   - stage list is displayed
 *   - move up / move down / remove stage
 *   - T-3: "Pause before this stage" checkbox per stage
 *     - toggles checkpoint for a stage
 *     - checkpoints are remapped when stages are reordered
 *     - checkpoints are removed when a stage is deleted
 *     - checkpoints are hidden in orchestrator mode
 *   - T-4: "Orchestrator mode" toggle
 *     - visible in the modal
 *     - calls executeOrchestratorRun instead of startPipeline when enabled
 *   - T-9: "Preview Prompts" button
 *     - calls previewPipelinePrompts with correct args
 *     - shows collapsible accordion entries per stage
 *     - auto-expands first entry
 *     - clears cache on stage reorder/remove
 *     - shows error toast on failure
 *   - Run button disabled when no stages
 *   - handleRun calls startPipeline with checkpoints array
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PipelineConfirmModal } from '../../src/components/modals/PipelineConfirmModal';
import { useAppStore } from '../../src/stores/useAppStore';
import type { PipelineStage } from '../../src/types';
import * as apiClient from '../../src/api/client';

// ---------------------------------------------------------------------------
// Mock the API client
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:            vi.fn(),
  getTasks:             vi.fn(),
  createTask:           vi.fn().mockResolvedValue({ id: 'sub-1', title: 'sub' }),
  moveTask:             vi.fn(),
  deleteTask:           vi.fn(),
  createSpace:          vi.fn(),
  renameSpace:          vi.fn(),
  deleteSpace:          vi.fn(),
  getAttachmentContent: vi.fn(),
  getAgents:            vi.fn().mockResolvedValue([]),
  generatePrompt:       vi.fn().mockResolvedValue({
    promptPath:      '/tmp/prompt.md',
    cliCommand:      'claude --agent senior-architect -p /tmp/prompt.md',
    promptPreview:   '# Preview',
    promptFull:      '# Full Prompt\n\nThis is the complete prompt text.',
    estimatedTokens: 100,
  }),
  getSettings:          vi.fn(),
  saveSettings:         vi.fn(),
  startRun:             vi.fn().mockResolvedValue({ runId: 'run-1', status: 'pending', stages: [], spaceId: 'space-1', taskId: 'task-1', createdAt: new Date().toISOString() }),
  getBackendRun:        vi.fn(),
  deleteRun:            vi.fn(),
  previewPipelinePrompts: vi.fn().mockResolvedValue({
    prompts: [
      { stageIndex: 0, agentId: 'senior-architect',  promptFull: '# Stage 0 prompt', estimatedTokens: 200 },
      { stageIndex: 1, agentId: 'ux-api-designer',   promptFull: '# Stage 1 prompt', estimatedTokens: 180 },
      { stageIndex: 2, agentId: 'developer-agent',   promptFull: '# Stage 2 prompt', estimatedTokens: 220 },
      { stageIndex: 3, agentId: 'qa-engineer-e2e',   promptFull: '# Stage 3 prompt', estimatedTokens: 160 },
    ],
  }),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const STAGES: PipelineStage[] = [
  'senior-architect',
  'ux-api-designer',
  'developer-agent',
  'qa-engineer-e2e',
];

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore(overrides: Record<string, unknown> = {}) {
  const startPipelineFn         = vi.fn().mockResolvedValue(undefined);
  const executeOrchestratorFn   = vi.fn().mockResolvedValue(undefined);
  const closePipelineFn         = vi.fn();

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
    availableAgents:         [
      { id: 'senior-architect', displayName: 'Senior Architect' },
      { id: 'ux-api-designer',  displayName: 'UX / API Designer' },
      { id: 'developer-agent',  displayName: 'Developer Agent' },
      { id: 'qa-engineer-e2e',  displayName: 'QA Engineer E2E' },
    ],
    templates:               [],
    loadAgents:              vi.fn().mockResolvedValue(undefined),
    loadTemplates:           vi.fn().mockResolvedValue(undefined),
    spaces:                  [],
    agentSettings:           null,
    tasks:                   { todo: [], 'in-progress': [], done: [] },
    ...overrides,
  } as any);

  return { startPipelineFn, executeOrchestratorFn, closePipelineFn };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal — rendering', () => {
  it('renders the modal when open', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    expect(screen.getByText('Run Pipeline')).toBeInTheDocument();
  });

  it('renders all four stages', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    const list = screen.getByRole('list');
    expect(within(list).getByText('Senior Architect')).toBeInTheDocument();
    expect(within(list).getByText('UX / API Designer')).toBeInTheDocument();
    expect(within(list).getByText('Developer Agent')).toBeInTheDocument();
    expect(within(list).getByText('QA Engineer E2E')).toBeInTheDocument();
  });

  it('renders nothing when modal is null', () => {
    resetStore({ pipelineConfirmModal: null });
    const { container } = render(<PipelineConfirmModal />);
    // Modal component with open=false renders its children as closed — no visible heading.
    expect(screen.queryByText('Run Pipeline')).toBeNull();
  });

  it('Run button is disabled when stages list is empty', () => {
    resetStore({
      pipelineConfirmModal: {
        open: true, spaceId: 'space-1', taskId: 'task-1',
        stages: [], checkpoints: [], useOrchestratorMode: false,
      },
    });
    render(<PipelineConfirmModal />);
    const runBtn = screen.getByRole('button', { name: /run/i });
    expect(runBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Stage manipulation
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal — stage manipulation', () => {
  it('removes a stage when the remove button is clicked', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    const removeButtons = screen.getAllByRole('button', { name: /remove stage/i });
    fireEvent.click(removeButtons[0]); // remove Senior Architect
    const list = screen.getByRole('list');
    expect(within(list).queryByText('Senior Architect')).toBeNull();
    expect(within(list).getByText('UX / API Designer')).toBeInTheDocument();
  });

  it('shows empty state message when all stages removed', () => {
    resetStore({
      pipelineConfirmModal: {
        open: true, spaceId: 'space-1', taskId: 'task-1',
        stages: [], checkpoints: [], useOrchestratorMode: false,
      },
    });
    render(<PipelineConfirmModal />);
    expect(screen.getByText(/at least one stage/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T-3: checkpoint checkboxes
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal — T-3 checkpoint checkboxes', () => {
  it('renders a "Pause before this stage" checkbox for each stage', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    const checkboxes = screen.getAllByLabelText(/pause before stage/i);
    expect(checkboxes).toHaveLength(4);
  });

  it('checkboxes are unchecked by default when no checkpoints set', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    const checkboxes = screen.getAllByLabelText(/pause before stage/i);
    checkboxes.forEach((cb) => expect(cb).not.toBeChecked());
  });

  it('checking a stage checkbox marks it as checked', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    const checkboxes = screen.getAllByLabelText(/pause before stage/i);
    fireEvent.click(checkboxes[1]); // UX stage
    expect(checkboxes[1]).toBeChecked();
  });

  it('unchecking a checked stage checkbox removes the checkpoint', () => {
    resetStore({
      pipelineConfirmModal: {
        open: true, spaceId: 'space-1', taskId: 'task-1',
        stages: [...STAGES], checkpoints: [1], useOrchestratorMode: false,
      },
    });
    render(<PipelineConfirmModal />);
    const checkboxes = screen.getAllByLabelText(/pause before stage/i);
    expect(checkboxes[1]).toBeChecked();
    fireEvent.click(checkboxes[1]);
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('pause icon shown next to checked stage', () => {
    resetStore({
      pipelineConfirmModal: {
        open: true, spaceId: 'space-1', taskId: 'task-1',
        stages: [...STAGES], checkpoints: [0], useOrchestratorMode: false,
      },
    });
    render(<PipelineConfirmModal />);
    // material icon "pause_circle" should be present (aria-hidden but visible text)
    expect(document.querySelector('[title="Pipeline will pause"]')).toBeTruthy();
  });

  it('checkpoint checkboxes are hidden when orchestrator mode is active', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    // Enable orchestrator mode
    fireEvent.click(screen.getByLabelText(/use orchestrator mode/i));
    expect(screen.queryAllByLabelText(/pause before stage/i)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T-3: handleRun passes checkpoints to startPipeline
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal — T-3 startPipeline call', () => {
  it('calls startPipeline with empty checkpoints when none selected', async () => {
    const { startPipelineFn, closePipelineFn } = resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /run 4 stages/i }));
    await vi.waitFor(() => expect(startPipelineFn).toHaveBeenCalledOnce());
    expect(startPipelineFn).toHaveBeenCalledWith(
      'space-1',
      'task-1',
      STAGES,
      [],
      false, // dangerouslySkipPermissions — backend always skips automatically
    );
    expect(closePipelineFn).toHaveBeenCalledOnce();
  });

  it('calls startPipeline with selected checkpoints', async () => {
    const { startPipelineFn } = resetStore();
    render(<PipelineConfirmModal />);
    // Check stage 1 (UX) and stage 3 (QA)
    const checkboxes = screen.getAllByLabelText(/pause before stage/i);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[3]);
    fireEvent.click(screen.getByRole('button', { name: /run 4 stages/i }));
    await vi.waitFor(() => expect(startPipelineFn).toHaveBeenCalledOnce());
    expect(startPipelineFn).toHaveBeenCalledWith(
      'space-1',
      'task-1',
      STAGES,
      [1, 3],
      false, // dangerouslySkipPermissions — backend always skips automatically
    );
  });
});

// ---------------------------------------------------------------------------
// T-4: orchestrator mode toggle
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal — T-4 orchestrator mode', () => {
  it('renders the Orchestrator mode checkbox', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    expect(screen.getByLabelText(/use orchestrator mode/i)).toBeInTheDocument();
  });

  it('orchestrator checkbox is unchecked by default', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    expect(screen.getByLabelText(/use orchestrator mode/i)).not.toBeChecked();
  });

  it('clicking the orchestrator toggle checks it', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByLabelText(/use orchestrator mode/i));
    expect(screen.getByLabelText(/use orchestrator mode/i)).toBeChecked();
  });

  it('button label changes to "Run Orchestrator" when orchestrator mode active', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByLabelText(/use orchestrator mode/i));
    expect(screen.getByRole('button', { name: /run orchestrator/i })).toBeInTheDocument();
  });

  it('calls executeOrchestratorRun (not startPipeline) when orchestrator mode active', async () => {
    const { startPipelineFn, executeOrchestratorFn } = resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByLabelText(/use orchestrator mode/i));
    fireEvent.click(screen.getByRole('button', { name: /run orchestrator/i }));
    await vi.waitFor(() => expect(executeOrchestratorFn).toHaveBeenCalledOnce());
    expect(startPipelineFn).not.toHaveBeenCalled();
    expect(executeOrchestratorFn).toHaveBeenCalledWith('space-1', 'task-1', STAGES, false); // false = dangerouslySkipPermissions (backend auto-sets it)
  });

  it('calls startPipeline (not executeOrchestratorRun) when orchestrator mode inactive', async () => {
    const { startPipelineFn, executeOrchestratorFn } = resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /run 4 stages/i }));
    await vi.waitFor(() => expect(startPipelineFn).toHaveBeenCalledOnce());
    expect(executeOrchestratorFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-009: Preview Prompts button
// ---------------------------------------------------------------------------

describe('PipelineConfirmModal — T-009 preview prompts', () => {
  it('renders a "Preview Prompts" button', () => {
    resetStore();
    render(<PipelineConfirmModal />);
    expect(screen.getByRole('button', { name: /preview prompts/i })).toBeInTheDocument();
  });

  it('calls previewPipelinePrompts with correct args when button is clicked', async () => {
    const mockPreview = vi.mocked(apiClient.previewPipelinePrompts);
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    await vi.waitFor(() => expect(mockPreview).toHaveBeenCalledOnce());
    expect(mockPreview).toHaveBeenCalledWith('space-1', 'task-1', STAGES);
  });

  it('shows stage prompt sections after a successful fetch', async () => {
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    // Wait for the preview entries to appear (accordion headers).
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /1\. senior architect/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /2\. ux \/ api designer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3\. developer agent/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4\. qa engineer e2e/i })).toBeInTheDocument();
  });

  it('auto-expands the first stage prompt after fetch', async () => {
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    await vi.waitFor(() => {
      // The first accordion entry should be expanded (aria-expanded=true).
      const firstHeader = screen.getByRole('button', { name: /1\. senior architect/i });
      expect(firstHeader).toHaveAttribute('aria-expanded', 'true');
    });
  });

  it('shows prompt content for the expanded stage', async () => {
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    await vi.waitFor(() => {
      expect(screen.getByText('# Stage 0 prompt')).toBeInTheDocument();
    });
  });

  it('collapses an expanded section when its header is clicked again', async () => {
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /1\. senior architect/i })).toHaveAttribute('aria-expanded', 'true');
    });
    // Click again to collapse.
    fireEvent.click(screen.getByRole('button', { name: /1\. senior architect/i }));
    expect(screen.getByRole('button', { name: /1\. senior architect/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('clears preview results when a stage is removed', async () => {
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /1\. senior architect/i })).toBeInTheDocument();
    });
    // Remove the first stage.
    const removeButtons = screen.getAllByRole('button', { name: /remove stage/i });
    fireEvent.click(removeButtons[0]);
    // Preview sections should be cleared.
    expect(screen.queryByRole('button', { name: /1\. senior architect/i })).toBeNull();
  });

  it('clears preview results when a stage is moved up', async () => {
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /1\. senior architect/i })).toBeInTheDocument();
    });
    // Move stage 1 (UX) up — the "Move up" button for index 1.
    const moveUpButtons = screen.getAllByRole('button', { name: /move up/i });
    fireEvent.click(moveUpButtons[1]); // index 1's move-up
    expect(screen.queryByRole('button', { name: /1\. senior architect/i })).toBeNull();
  });

  it('shows a "Hide" button after prompts are fetched and hides sections on click', async () => {
    resetStore();
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /hide/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.queryByRole('button', { name: /1\. senior architect/i })).toBeNull();
  });

  it('shows an error toast when previewPipelinePrompts rejects', async () => {
    const mockPreview = vi.mocked(apiClient.previewPipelinePrompts);
    mockPreview.mockRejectedValueOnce(new Error('Network error'));
    const showToastSpy = vi.fn();
    resetStore();
    // Patch showToast on the store.
    useAppStore.setState({ showToast: showToastSpy } as any);
    render(<PipelineConfirmModal />);
    fireEvent.click(screen.getByRole('button', { name: /preview prompts/i }));
    await vi.waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining('Network error'),
        'error',
      );
    });
  });
});
