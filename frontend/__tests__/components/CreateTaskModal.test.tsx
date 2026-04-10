import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateTaskModal } from '../../src/components/modals/CreateTaskModal';
import { useAppStore } from '../../src/stores/useAppStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

beforeEach(() => {
  useAppStore.setState({
    createModalOpen: false,
    activeSpaceId: 'default',
    isMutating: false,
  });
  vi.clearAllMocks();
});

describe('CreateTaskModal', () => {
  it('does not render when modal is closed', () => {
    render(<CreateTaskModal />);
    expect(screen.queryByText('New Task')).not.toBeInTheDocument();
  });

  it('renders form when modal is open', () => {
    useAppStore.setState({ createModalOpen: true });
    render(<CreateTaskModal />);
    expect(screen.getByText('New Task')).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/type/i)).toBeInTheDocument();
  });

  it('shows title validation error when submitting empty title', async () => {
    useAppStore.setState({ createModalOpen: true });
    render(<CreateTaskModal />);

    fireEvent.submit(screen.getByRole('button', { name: /create task/i }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument();
    });
  });

  it('shows type validation error when submitting without type', async () => {
    useAppStore.setState({ createModalOpen: true });
    const user = userEvent.setup();
    render(<CreateTaskModal />);

    await user.type(screen.getByLabelText(/title/i), 'Some title');
    fireEvent.submit(screen.getByRole('button', { name: /create task/i }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Type is required')).toBeInTheDocument();
    });
  });

  it('shows character counter', async () => {
    useAppStore.setState({ createModalOpen: true });
    const user = userEvent.setup();
    render(<CreateTaskModal />);

    await user.type(screen.getByLabelText(/title/i), 'abc');
    expect(screen.getByText('3 / 200')).toBeInTheDocument();
  });

  it('select shows the 4 new types and not the legacy ones', () => {
    useAppStore.setState({ createModalOpen: true });
    render(<CreateTaskModal />);
    const select = screen.getByLabelText(/type/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('feature');
    expect(values).toContain('bug');
    expect(values).toContain('tech-debt');
    expect(values).toContain('chore');
    expect(values).not.toContain('task');
    expect(values).not.toContain('research');
  });

  it('closes when Cancel button is clicked', () => {
    const closeModal = vi.fn();
    useAppStore.setState({ createModalOpen: true, closeCreateModal: closeModal } as any);
    render(<CreateTaskModal />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(closeModal).toHaveBeenCalled();
  });

  it('submits with correct payload including optional fields', async () => {
    const mockCreateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ createModalOpen: true, createTask: mockCreateTask } as any);
    const user = userEvent.setup();
    render(<CreateTaskModal />);

    await user.type(screen.getByLabelText(/title/i), 'New Feature');
    await user.selectOptions(screen.getByLabelText(/type/i), 'feature');
    await user.type(screen.getByLabelText(/description/i), 'Some details');

    await user.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Feature',
          type: 'feature',
          description: 'Some details',
        })
      );
    });
  });

  it('does not include assigned when empty', async () => {
    const mockCreateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ createModalOpen: true, createTask: mockCreateTask } as any);
    const user = userEvent.setup();
    render(<CreateTaskModal />);

    await user.type(screen.getByLabelText(/title/i), 'Title');
    await user.selectOptions(screen.getByLabelText(/type/i), 'chore');
    await user.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => {
      const payload = mockCreateTask.mock.calls[0][0];
      expect(payload.assigned).toBeUndefined();
    });
  });
});
