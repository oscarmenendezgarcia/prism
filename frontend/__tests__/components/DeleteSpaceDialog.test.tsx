import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteSpaceDialog } from '../../src/components/modals/DeleteSpaceDialog';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

const mockGetTasks = vi.mocked(api.getTasks);

const SPACE = { id: 'space-1', name: 'My Space', createdAt: '', updatedAt: '' };

function openDialog(spaceId = 'space-1') {
  useAppStore.setState({
    deleteSpaceDialog: { open: true, spaceId },
    spaces: [SPACE],
  });
}

beforeEach(() => {
  useAppStore.setState({ deleteSpaceDialog: null, spaces: [] });
  vi.clearAllMocks();
});

describe('DeleteSpaceDialog — closed state', () => {
  it('renders nothing when dialog is null', () => {
    render(<DeleteSpaceDialog />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('renders nothing when open is false', () => {
    useAppStore.setState({
      deleteSpaceDialog: { open: false, spaceId: 'space-1' },
      spaces: [SPACE],
    });
    render(<DeleteSpaceDialog />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('DeleteSpaceDialog — open state', () => {
  it('renders the space name in the title', async () => {
    mockGetTasks.mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    openDialog();
    render(<DeleteSpaceDialog />);

    expect(screen.getByText(/Delete.*My Space/)).toBeInTheDocument();
  });

  it('renders the irreversible warning text', async () => {
    mockGetTasks.mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    openDialog();
    render(<DeleteSpaceDialog />);

    expect(
      screen.getByText(/permanently delete the space and all its tasks/i)
    ).toBeInTheDocument();
  });

  it('renders Cancel and Delete buttons', async () => {
    mockGetTasks.mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    openDialog();
    render(<DeleteSpaceDialog />);

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });
});

describe('DeleteSpaceDialog — task count display', () => {
  it('shows task count banner when tasks exist', async () => {
    mockGetTasks.mockResolvedValue({
      todo: [{ id: 't1', title: 'T1', type: 'chore', createdAt: '', updatedAt: '' }],
      'in-progress': [],
      done: [{ id: 't2', title: 'T2', type: 'chore', createdAt: '', updatedAt: '' }],
    });
    openDialog();
    render(<DeleteSpaceDialog />);

    await waitFor(() => {
      expect(screen.getByText(/2 tasks will be deleted/i)).toBeInTheDocument();
    });
  });

  it('shows singular "task" when count is 1', async () => {
    mockGetTasks.mockResolvedValue({
      todo: [{ id: 't1', title: 'T1', type: 'chore', createdAt: '', updatedAt: '' }],
      'in-progress': [],
      done: [],
    });
    openDialog();
    render(<DeleteSpaceDialog />);

    await waitFor(() => {
      expect(screen.getByText(/1 task will be deleted/i)).toBeInTheDocument();
    });
  });

  it('does not show task count banner when space has no tasks', async () => {
    mockGetTasks.mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    openDialog();
    render(<DeleteSpaceDialog />);

    // Wait for the API call to resolve
    await waitFor(() => {
      expect(mockGetTasks).toHaveBeenCalled();
    });
    expect(screen.queryByText(/will be deleted/i)).not.toBeInTheDocument();
  });

  it('does not show task count banner when task fetch fails', async () => {
    mockGetTasks.mockRejectedValue(new Error('Network error'));
    openDialog();
    render(<DeleteSpaceDialog />);

    await waitFor(() => {
      expect(mockGetTasks).toHaveBeenCalled();
    });
    expect(screen.queryByText(/will be deleted/i)).not.toBeInTheDocument();
  });
});

describe('DeleteSpaceDialog — Cancel action', () => {
  it('Cancel button calls closeDeleteSpaceDialog', async () => {
    mockGetTasks.mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    const mockClose = vi.fn();
    useAppStore.setState({
      deleteSpaceDialog: { open: true, spaceId: 'space-1' },
      spaces: [SPACE],
      closeDeleteSpaceDialog: mockClose,
    } as any);

    render(<DeleteSpaceDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(mockClose).toHaveBeenCalled();
  });
});

describe('DeleteSpaceDialog — Delete action', () => {
  it('calls deleteSpace store action on confirm', async () => {
    mockGetTasks.mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    const mockDeleteSpace = vi.fn().mockResolvedValue(undefined);
    const mockClose = vi.fn();
    useAppStore.setState({
      deleteSpaceDialog: { open: true, spaceId: 'space-1' },
      spaces: [SPACE],
      deleteSpace: mockDeleteSpace,
      closeDeleteSpaceDialog: mockClose,
    } as any);

    render(<DeleteSpaceDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(mockDeleteSpace).toHaveBeenCalledWith('space-1');
    });
  });

  it('shows Deleting... label while submitting', async () => {
    mockGetTasks.mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    // Never resolves so we stay in submitting state
    const mockDeleteSpace = vi.fn().mockReturnValue(new Promise(() => {}));
    useAppStore.setState({
      deleteSpaceDialog: { open: true, spaceId: 'space-1' },
      spaces: [SPACE],
      deleteSpace: mockDeleteSpace,
    } as any);

    render(<DeleteSpaceDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /deleting/i })).toBeInTheDocument();
    });
  });

  it('disables both buttons while submitting', async () => {
    mockGetTasks.mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    const mockDeleteSpace = vi.fn().mockReturnValue(new Promise(() => {}));
    useAppStore.setState({
      deleteSpaceDialog: { open: true, spaceId: 'space-1' },
      spaces: [SPACE],
      deleteSpace: mockDeleteSpace,
    } as any);

    render(<DeleteSpaceDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled();
    });
  });

  it('re-enables submit button when deleteSpace throws', async () => {
    mockGetTasks.mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    const mockDeleteSpace = vi.fn().mockRejectedValue(new Error('API error'));
    const mockClose = vi.fn();
    useAppStore.setState({
      deleteSpaceDialog: { open: true, spaceId: 'space-1' },
      spaces: [SPACE],
      deleteSpace: mockDeleteSpace,
      closeDeleteSpaceDialog: mockClose,
    } as any);

    render(<DeleteSpaceDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^delete$/i })).not.toBeDisabled();
    });
  });
});
