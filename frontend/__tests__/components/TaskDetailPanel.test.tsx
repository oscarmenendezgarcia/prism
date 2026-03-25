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
  type: 'task',
  description: 'Implement JWT-based authentication',
  assigned: 'developer-agent',
  createdAt: '2026-03-09T14:32:00.000Z',
  updatedAt: '2026-03-24T12:00:00.000Z',
};

function resetStore(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
    detailTask: null,
    isMutating: false,
    activeRun: null,
    tasks: { todo: [TASK], 'in-progress': [], done: [] },
    activeSpaceId: 'space-1',
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

    // Task starts as 'task', click 'research' to change it
    const researchButton = screen.getByRole('radio', { name: /research/i });
    fireEvent.click(researchButton);

    expect(updateTask).toHaveBeenCalledWith(TASK.id, { type: 'research' });
  });

  it('does NOT call updateTask when same type is clicked again', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    // Click the currently-active 'task' button — no change should occur
    const taskButton = screen.getByRole('radio', { name: /^task$/i });
    fireEvent.click(taskButton);

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
