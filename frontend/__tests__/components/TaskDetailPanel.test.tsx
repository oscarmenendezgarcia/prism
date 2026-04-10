/**
 * Unit tests for TaskDetailPanel component.
 * T-006: covers open/close lifecycle, all four field save paths,
 * disabled state during isMutating, read-only state during activeRun,
 * keyboard accessibility (Escape), and focus management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskDetailPanel } from '../../src/components/board/TaskDetailPanel';
import { useAppStore } from '../../src/stores/useAppStore';
import type { Task } from '../../src/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:         vi.fn(),
  getTasks:          vi.fn(),
  createTask:        vi.fn(),
  moveTask:          vi.fn(),
  deleteTask:        vi.fn(),
  createSpace:       vi.fn(),
  renameSpace:       vi.fn(),
  deleteSpace:       vi.fn(),
  getAttachmentContent: vi.fn(),
  updateTask:        vi.fn(),
  getAgents:         vi.fn(),
  generatePrompt:    vi.fn(),
  getSettings:       vi.fn().mockResolvedValue({}),
  saveSettings:      vi.fn(),
  createAgentRun:    vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun:    vi.fn().mockResolvedValue({ id: 'run_mock', status: 'completed' }),
  getAgentRuns:      vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  startRun:          vi.fn(),
  getBackendRun:     vi.fn(),
  deleteRun:         vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TASK: Task = {
  id: 'task-abc-1234567',
  title: 'Build auth flow',
  type: 'feature',
  description: 'Implement JWT-based authentication',
  assigned: 'developer-agent',
  createdAt: '2026-03-09T14:32:00.000Z',
  updatedAt: '2026-03-24T12:00:00.000Z',
};

const TASK_WITH_ATTACHMENTS: Task = {
  ...TASK,
  id: 'task-attach-789',
  attachments: [
    { name: 'ADR-1.md',    type: 'text' },
    { name: 'diagram.png', type: 'file' },
    { name: 'notes.txt',   type: 'text' },
  ],
};

const TASK_WITH_PIPELINE: Task = {
  ...TASK,
  id: 'task-pipeline-456',
  pipeline: ['developer-agent', 'qa-engineer-e2e'],
};

const AVAILABLE_AGENTS = [
  { id: 'senior-architect',   name: 'senior-architect.md',   displayName: 'Senior Architect',   path: '/tmp/senior-architect.md',   sizeBytes: 100 },
  { id: 'developer-agent',    name: 'developer-agent.md',    displayName: 'Developer Agent',    path: '/tmp/developer-agent.md',    sizeBytes: 100 },
  { id: 'qa-engineer-e2e',    name: 'qa-engineer-e2e.md',    displayName: 'QA Engineer E2E',    path: '/tmp/qa-engineer-e2e.md',    sizeBytes: 100 },
  { id: 'ux-api-designer',    name: 'ux-api-designer.md',    displayName: 'UX API Designer',    path: '/tmp/ux-api-designer.md',    sizeBytes: 100 },
];

function resetStore(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
    detailTask: null,
    isMutating: false,
    activeRun: null,
    tasks: { todo: [TASK, TASK_WITH_PIPELINE, TASK_WITH_ATTACHMENTS], 'in-progress': [], done: [] },
    activeSpaceId: 'space-1',
    availableAgents: AVAILABLE_AGENTS,
    ...overrides,
  } as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe('TaskDetailPanel — render state', () => {
  it('renders null when detailTask is null', () => {
    const { container } = render(<TaskDetailPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders panel when detailTask is set', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('pre-populates title input with task title', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/title/i)).toHaveValue(TASK.title);
  });

  it('pre-populates assigned input with task assigned', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/assigned/i)).toHaveValue(TASK.assigned);
  });

  it('pre-populates description textarea with task description', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/description/i)).toHaveValue(TASK.description);
  });

  it('shows the task short ID in the header', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByText(`#${TASK.id.slice(-7)}`)).toBeInTheDocument();
  });

  it('shows read-only createdAt and updatedAt in the footer', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    // Both timestamps appear somewhere in the footer area.
    expect(screen.getByText(/created/i)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
  });
});

describe('TaskDetailPanel — close actions', () => {
  it('calls closeDetailPanel when close button is clicked', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /close task detail/i }));
    expect(closeDetailPanel).toHaveBeenCalled();
  });

  it('calls closeDetailPanel when backdrop is clicked', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    // The backdrop is the first child of the portal — aria-hidden div
    const backdrop = document.body.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(closeDetailPanel).toHaveBeenCalled();
  });

  it('calls closeDetailPanel when Escape key is pressed', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeDetailPanel).toHaveBeenCalled();
  });
});

describe('TaskDetailPanel — auto-save on blur: title', () => {
  it('calls store.updateTask with { title } when title input is blurred with a changed value', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'New Title' } });
    fireEvent.blur(titleInput);

    expect(updateTask).toHaveBeenCalledWith(TASK.id, { title: 'New Title' });
  });

  it('does NOT call updateTask when title blur has no change', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.focus(titleInput);
    fireEvent.blur(titleInput);

    expect(updateTask).not.toHaveBeenCalled();
  });

  it('reverts title input to saved value when user clears it and blurs', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: '' } });
    fireEvent.blur(titleInput);

    expect(updateTask).not.toHaveBeenCalled();
    expect(titleInput).toHaveValue(TASK.title);
  });
});

describe('TaskDetailPanel — auto-save on blur: assigned', () => {
  it('calls store.updateTask with { assigned } when assigned input is blurred with a changed value', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const assignedInput = screen.getByLabelText(/assigned/i);
    fireEvent.change(assignedInput, { target: { value: 'senior-architect' } });
    fireEvent.blur(assignedInput);

    expect(updateTask).toHaveBeenCalledWith(TASK.id, { assigned: 'senior-architect' });
  });

  it('sends empty string for assigned when user clears the field', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const assignedInput = screen.getByLabelText(/assigned/i);
    fireEvent.change(assignedInput, { target: { value: '' } });
    fireEvent.blur(assignedInput);

    expect(updateTask).toHaveBeenCalledWith(TASK.id, { assigned: '' });
  });
});

describe('TaskDetailPanel — auto-save on change: type', () => {
  it('calls store.updateTask with { type } immediately when type button is clicked', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    // Task starts as 'feature', click 'bug' to change it
    const bugButton = screen.getByRole('radio', { name: /^bug$/i });
    fireEvent.click(bugButton);

    expect(updateTask).toHaveBeenCalledWith(TASK.id, { type: 'bug' });
  });

  it('does NOT call updateTask when same type is clicked again', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    // Click the currently-active 'feature' button — no change should occur
    const featureButton = screen.getByRole('radio', { name: /^feature$/i });
    fireEvent.click(featureButton);

    expect(updateTask).not.toHaveBeenCalled();
  });
});

describe('TaskDetailPanel — explicit save: description', () => {
  it('calls store.updateTask with { description } when Save description button is clicked', async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const textarea = screen.getByLabelText(/description/i);
    // Use fireEvent directly to avoid cross-test focus contamination with userEvent.
    fireEvent.change(textarea, { target: { value: 'Updated description text' } });
    fireEvent.click(screen.getByRole('button', { name: /save description/i }));

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith(TASK.id, { description: 'Updated description text' });
    });
  });
});

describe('TaskDetailPanel — disabled state during isMutating', () => {
  it('disables title input when isMutating is true', () => {
    useAppStore.setState({ detailTask: TASK, isMutating: true } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/title/i)).toBeDisabled();
  });

  it('disables assigned input when isMutating is true', () => {
    useAppStore.setState({ detailTask: TASK, isMutating: true } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/assigned/i)).toBeDisabled();
  });

  it('disables description textarea when isMutating is true', () => {
    useAppStore.setState({ detailTask: TASK, isMutating: true } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/description/i)).toBeDisabled();
  });

  it('disables type radio buttons when isMutating is true', () => {
    useAppStore.setState({ detailTask: TASK, isMutating: true } as any);
    render(<TaskDetailPanel />);
    const radios = screen.getAllByRole('radio');
    radios.forEach((r) => expect(r).toBeDisabled());
  });

  it('disables Save description button when isMutating is true', () => {
    useAppStore.setState({ detailTask: TASK, isMutating: true } as any);
    render(<TaskDetailPanel />);
    // The button is disabled; text changes to "Saving..."
    const btn = document.body.querySelector('button[disabled]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
  });
});

describe('TaskDetailPanel — read-only state during activeRun', () => {
  it('disables all inputs when activeRun matches task id', () => {
    useAppStore.setState({
      detailTask: TASK,
      activeRun: {
        taskId: TASK.id,
        agentId: 'developer-agent',
        spaceId: 'space-1',
        startedAt: new Date().toISOString(),
        cliCommand: 'claude',
        promptPath: '/tmp/prompt.md',
      },
    } as any);
    render(<TaskDetailPanel />);

    expect(screen.getByLabelText(/title/i)).toBeDisabled();
    expect(screen.getByLabelText(/assigned/i)).toBeDisabled();
    expect(screen.getByLabelText(/description/i)).toBeDisabled();
  });

  it('shows the active run warning banner', () => {
    useAppStore.setState({
      detailTask: TASK,
      activeRun: {
        taskId: TASK.id,
        agentId: 'developer-agent',
        spaceId: 'space-1',
        startedAt: new Date().toISOString(),
        cliCommand: 'claude',
        promptPath: '/tmp/prompt.md',
      },
    } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByText(/agent pipeline is running/i)).toBeInTheDocument();
  });

  it('does NOT disable inputs when activeRun is for a different task', () => {
    useAppStore.setState({
      detailTask: TASK,
      isMutating: false,
      activeRun: {
        taskId: 'different-task-id',
        agentId: 'developer-agent',
        spaceId: 'space-1',
        startedAt: new Date().toISOString(),
        cliCommand: 'claude',
        promptPath: '/tmp/prompt.md',
      },
    } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/title/i)).not.toBeDisabled();
  });
});

describe('TaskDetailPanel — ID copy', () => {
  it('renders the full task ID in the ID field', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByText(TASK.id)).toBeInTheDocument();
  });

  it('renders a copy button with aria-label "Copy task ID"', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('button', { name: /copy task id/i })).toBeInTheDocument();
  });

  it('calls navigator.clipboard.writeText with full task ID on copy button click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const showToast = vi.fn();
    useAppStore.setState({ detailTask: TASK, showToast } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /copy task id/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(TASK.id);
      expect(showToast).toHaveBeenCalledWith('Task ID copied to clipboard', 'success');
    });
  });

  it('calls showToast with error when clipboard.writeText throws', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    const showToast = vi.fn();
    useAppStore.setState({ detailTask: TASK, showToast } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /copy task id/i }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Failed to copy ID', 'error');
    });
  });
});

describe('TaskDetailPanel — ARIA accessibility', () => {
  it('has role="dialog" and aria-modal="true"', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('has aria-label="Task detail"', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Task detail');
  });

  it('close button has aria-label="Close task detail"', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('button', { name: /close task detail/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T-011: Pipeline field editor in TaskDetailPanel
// ---------------------------------------------------------------------------

describe('TaskDetailPanel — pipeline field: collapsed state (no pipeline)', () => {
  it('shows Pipeline label and "(space default)" when task has no pipeline', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByText(/pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/\(space default\)/i)).toBeInTheDocument();
  });

  it('shows a "Configure" button when task has no pipeline', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('button', { name: /configure pipeline/i })).toBeInTheDocument();
  });

  it('does not show an agent chain when pipeline is absent', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    // The arrow separator → only appears in the chip chain
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });
});

describe('TaskDetailPanel — pipeline field: collapsed state (pipeline set)', () => {
  it('shows the agent chain as text with → separators', () => {
    useAppStore.setState({ detailTask: TASK_WITH_PIPELINE } as any);
    render(<TaskDetailPanel />);
    // The component renders pipeline.join(' → ')
    const pipelineSection = document.body.querySelector('[data-testid="pipeline-collapsed"]') ?? document.body;
    expect(pipelineSection.textContent).toMatch(/developer-agent.*qa-engineer-e2e/);
  });

  it('shows Edit and Clear buttons when pipeline is set', () => {
    useAppStore.setState({ detailTask: TASK_WITH_PIPELINE } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('button', { name: /edit pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear pipeline/i })).toBeInTheDocument();
  });

  it('Clear button calls updateTask with empty array (clear semantics)', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK_WITH_PIPELINE, updateTask } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /clear pipeline/i }));
    expect(updateTask).toHaveBeenCalledWith(TASK_WITH_PIPELINE.id, { pipeline: [] });
  });
});

// BUG-001: loadAgents() called when panel opens and agents are not yet loaded
describe('TaskDetailPanel — pipeline field: agent loading (BUG-001)', () => {
  it('calls loadAgents when the panel opens and availableAgents is empty', () => {
    const loadAgents = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      detailTask: TASK,
      availableAgents: [],
      loadAgents,
    } as any);
    render(<TaskDetailPanel />);
    expect(loadAgents).toHaveBeenCalled();
  });

  it('does NOT call loadAgents when availableAgents is already populated', () => {
    const loadAgents = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      detailTask: TASK,
      availableAgents: AVAILABLE_AGENTS,
      loadAgents,
    } as any);
    render(<TaskDetailPanel />);
    expect(loadAgents).not.toHaveBeenCalled();
  });

  it('does NOT call loadAgents when the panel is closed (detailTask is null)', () => {
    const loadAgents = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      detailTask: null,
      availableAgents: [],
      loadAgents,
    } as any);
    render(<TaskDetailPanel />);
    expect(loadAgents).not.toHaveBeenCalled();
  });
});

describe('TaskDetailPanel — pipeline field: edit mode', () => {
  it('clicking Configure opens the edit mode with empty stage list', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /configure pipeline/i }));
    // Edit mode shows the add-stage dropdown
    expect(screen.getByRole('combobox', { name: /add a stage/i })).toBeInTheDocument();
    // Save and Cancel buttons appear
    expect(screen.getByRole('button', { name: /save pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('clicking Edit opens the edit mode with current stages pre-populated', () => {
    useAppStore.setState({ detailTask: TASK_WITH_PIPELINE } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /edit pipeline/i }));
    // Both pipeline stages should appear in the ordered list
    const items = screen.getAllByRole('listitem');
    expect(items.some((el) => el.textContent?.includes('developer-agent'))).toBe(true);
    expect(items.some((el) => el.textContent?.includes('qa-engineer-e2e'))).toBe(true);
  });

  it('clicking Cancel in edit mode restores the collapsed view without saving', () => {
    const updateTask = vi.fn();
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /configure pipeline/i }));
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Collapsed state restored — Configure button visible again
    expect(screen.getByRole('button', { name: /configure pipeline/i })).toBeInTheDocument();
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('clicking Save calls updateTask with the current draft stages', async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK_WITH_PIPELINE, updateTask } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /edit pipeline/i }));
    fireEvent.click(screen.getByRole('button', { name: /save pipeline/i }));

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith(
        TASK_WITH_PIPELINE.id,
        { pipeline: ['developer-agent', 'qa-engineer-e2e'] },
      );
    });
  });

  it('removing a stage in edit mode and saving calls updateTask with reduced array', async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK_WITH_PIPELINE, updateTask } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /edit pipeline/i }));

    // Remove the first stage (developer-agent)
    const removeBtn = screen.getByRole('button', { name: /remove developer-agent from pipeline/i });
    fireEvent.click(removeBtn);

    fireEvent.click(screen.getByRole('button', { name: /save pipeline/i }));

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith(
        TASK_WITH_PIPELINE.id,
        { pipeline: ['qa-engineer-e2e'] },
      );
    });
  });

  it('Save with empty stage list calls updateTask with empty array', async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK_WITH_PIPELINE, updateTask } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /edit pipeline/i }));

    // Remove all stages
    const removeBtns = screen.getAllByRole('button', { name: /remove .* from pipeline/i });
    for (const btn of removeBtns) {
      fireEvent.click(btn);
    }

    fireEvent.click(screen.getByRole('button', { name: /save pipeline/i }));

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith(
        TASK_WITH_PIPELINE.id,
        { pipeline: [] },
      );
    });
  });

  it('pipeline editor is disabled when fieldDisabled is true (isMutating)', () => {
    useAppStore.setState({ detailTask: TASK_WITH_PIPELINE, isMutating: true } as any);
    render(<TaskDetailPanel />);

    const editBtn = screen.getByRole('button', { name: /edit pipeline/i });
    expect(editBtn).toBeDisabled();

    const clearBtn = screen.getByRole('button', { name: /clear pipeline/i });
    expect(clearBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// BUG FIX: Attachments section — all attachments must render in the panel
// ---------------------------------------------------------------------------

describe('TaskDetailPanel — attachments section', () => {
  it('does not render the attachments section when task has no attachments', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    const { container } = render(<TaskDetailPanel />);
    expect(container.querySelector('[data-testid="attachments-section"]')).not.toBeInTheDocument();
  });

  it('does not render the attachments section when attachments is an empty array', () => {
    useAppStore.setState({ detailTask: { ...TASK, attachments: [] } } as any);
    const { container } = render(<TaskDetailPanel />);
    expect(container.querySelector('[data-testid="attachments-section"]')).not.toBeInTheDocument();
  });

  it('renders the Attachments heading when task has attachments', () => {
    useAppStore.setState({ detailTask: TASK_WITH_ATTACHMENTS } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByText(/attachments/i)).toBeInTheDocument();
  });

  it('renders one row per attachment — all 3 attachments are visible', () => {
    useAppStore.setState({ detailTask: TASK_WITH_ATTACHMENTS } as any);
    const { container } = render(<TaskDetailPanel />);
    const rows = container.querySelectorAll('[data-testid="attachment-row"]');
    expect(rows).toHaveLength(3);
  });

  it('each attachment row shows the correct filename', () => {
    useAppStore.setState({ detailTask: TASK_WITH_ATTACHMENTS } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByText('ADR-1.md')).toBeInTheDocument();
    expect(screen.getByText('diagram.png')).toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
  });

  it('clicking the first attachment row calls openAttachmentModal with index 0 and full list', () => {
    const openAttachmentModal = vi.fn();
    useAppStore.setState({
      detailTask: TASK_WITH_ATTACHMENTS,
      activeSpaceId: 'space-1',
      openAttachmentModal,
    } as any);
    const { container } = render(<TaskDetailPanel />);

    const rows = container.querySelectorAll('[data-testid="attachment-row"]');
    fireEvent.click(rows[0]);

    expect(openAttachmentModal).toHaveBeenCalledWith(
      'space-1', TASK_WITH_ATTACHMENTS.id, 0, 'ADR-1.md', TASK_WITH_ATTACHMENTS.attachments,
    );
  });

  it('clicking the second attachment row calls openAttachmentModal with index 1 and full list', () => {
    const openAttachmentModal = vi.fn();
    useAppStore.setState({
      detailTask: TASK_WITH_ATTACHMENTS,
      activeSpaceId: 'space-1',
      openAttachmentModal,
    } as any);
    const { container } = render(<TaskDetailPanel />);

    const rows = container.querySelectorAll('[data-testid="attachment-row"]');
    fireEvent.click(rows[1]);

    expect(openAttachmentModal).toHaveBeenCalledWith(
      'space-1', TASK_WITH_ATTACHMENTS.id, 1, 'diagram.png', TASK_WITH_ATTACHMENTS.attachments,
    );
  });

  it('clicking the third attachment row calls openAttachmentModal with index 2 and full list', () => {
    const openAttachmentModal = vi.fn();
    useAppStore.setState({
      detailTask: TASK_WITH_ATTACHMENTS,
      activeSpaceId: 'space-1',
      openAttachmentModal,
    } as any);
    const { container } = render(<TaskDetailPanel />);

    const rows = container.querySelectorAll('[data-testid="attachment-row"]');
    fireEvent.click(rows[2]);

    expect(openAttachmentModal).toHaveBeenCalledWith(
      'space-1', TASK_WITH_ATTACHMENTS.id, 2, 'notes.txt', TASK_WITH_ATTACHMENTS.attachments,
    );
  });

  it('each attachment row has an accessible aria-label with the filename', () => {
    useAppStore.setState({ detailTask: TASK_WITH_ATTACHMENTS } as any);
    render(<TaskDetailPanel />);

    expect(screen.getByRole('button', { name: 'Open attachment ADR-1.md' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open attachment diagram.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open attachment notes.txt' })).toBeInTheDocument();
  });
});
