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
    tasks: {},
  });
  vi.clearAllMocks();
});

describe('CreateTaskModal', () => {
  it('does not render when modal is closed', () => {
    render(<CreateTaskModal />);
    expect(screen.queryByText('New issue')).not.toBeInTheDocument();
  });

  it('renders form when modal is open', () => {
    useAppStore.setState({ createModalOpen: true });
    render(<CreateTaskModal />);
    expect(screen.getByText('New issue')).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    // Type field is now a chip group (role="group")
    expect(screen.getByRole('group', { name: /issue type/i })).toBeInTheDocument();
  });

  it('shows title validation error when submitting empty title', async () => {
    useAppStore.setState({ createModalOpen: true });
    render(<CreateTaskModal />);

    fireEvent.submit(screen.getByRole('button', { name: /create issue/i }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument();
    });
  });

  it('shows type validation error when submitting without type', async () => {
    useAppStore.setState({ createModalOpen: true });
    const user = userEvent.setup();
    render(<CreateTaskModal />);

    await user.type(screen.getByLabelText(/title/i), 'Some title');
    fireEvent.submit(screen.getByRole('button', { name: /create issue/i }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Type is required')).toBeInTheDocument();
    });
  });

  it('shows character counter', async () => {
    useAppStore.setState({ createModalOpen: true });
    const user = userEvent.setup();
    render(<CreateTaskModal />);

    const title = screen.getByLabelText(/title/i);
    await user.type(title, 'abc');
    // Only once it is close to the limit: the form has little room.
    expect(screen.queryByText('3 / 200')).not.toBeInTheDocument();
    fireEvent.change(title, { target: { value: 'x'.repeat(151) } });
    expect(screen.getByText('151 / 200')).toBeInTheDocument();
  });

  it('chip group shows the issue types, epic included, and not the legacy ones', () => {
    useAppStore.setState({ createModalOpen: true });
    render(<CreateTaskModal />);
    // Type is now a chip group of radio buttons
    const chipGroup = screen.getByRole('group', { name: /issue type/i });
    expect(chipGroup).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Feature', 'Bug', 'Chore', 'Tech debt', 'Epic']);
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
    // Click the 'feature' chip instead of selectOptions
    await user.click(screen.getByRole('radio', { name: 'Feature' }));
    await user.type(screen.getByLabelText(/description/i), 'Some details');

    await user.click(screen.getByRole('button', { name: /create issue/i }));

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
    // Click the 'chore' chip
    await user.click(screen.getByRole('radio', { name: 'Chore' }));
    await user.click(screen.getByRole('button', { name: /create issue/i }));

    await waitFor(() => {
      const payload = mockCreateTask.mock.calls[0][0];
      expect(payload.assigned).toBeUndefined();
    });
  });

  describe('issue fields', () => {
    const EPIC = { id: 'e1', title: 'Checkout', type: 'epic' as const, createdAt: '', updatedAt: '' };

    function openWith(mockCreateTask: ReturnType<typeof vi.fn>) {
      useAppStore.setState({ createModalOpen: true, createTask: mockCreateTask, tasks: { todo: [EPIC] } } as any);
      render(<CreateTaskModal />);
      fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'T' } });
    }

    it('sends medium priority and nothing else optional by default', async () => {
      const mockCreateTask = vi.fn().mockResolvedValue(undefined);
      openWith(mockCreateTask);
      fireEvent.click(screen.getByRole('radio', { name: 'Bug' }));
      fireEvent.click(screen.getByRole('button', { name: /create issue/i }));
      await waitFor(() => expect(mockCreateTask).toHaveBeenCalledWith({ title: 'T', type: 'bug', priority: 'medium' }));
    });

    it('sends the priority, epic, labels and due date chosen', async () => {
      const mockCreateTask = vi.fn().mockResolvedValue(undefined);
      openWith(mockCreateTask);
      fireEvent.click(screen.getByRole('radio', { name: 'Bug' }));
      fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: 'urgent' } });
      fireEvent.change(screen.getByLabelText(/^epic$/i), { target: { value: 'e1' } });
      fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: '2030-01-02' } });
      const labels = screen.getByRole('textbox', { name: 'Add a label' });
      fireEvent.change(labels, { target: { value: 'ui' } });
      fireEvent.keyDown(labels, { key: 'Enter' });
      fireEvent.click(screen.getByRole('button', { name: /create issue/i }));
      await waitFor(() => expect(mockCreateTask).toHaveBeenCalledWith({
        title: 'T', type: 'bug', priority: 'urgent', parentId: 'e1', labels: ['ui'], dueDate: '2030-01-02',
      }));
    });

    it('does not let an epic go inside an epic', async () => {
      const mockCreateTask = vi.fn().mockResolvedValue(undefined);
      openWith(mockCreateTask);
      fireEvent.change(screen.getByLabelText(/^epic$/i), { target: { value: 'e1' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Epic' }));
      expect(screen.getByLabelText(/^epic$/i)).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /create issue/i }));
      await waitFor(() => expect(mockCreateTask).toHaveBeenCalled());
      expect(mockCreateTask.mock.calls[0][0].parentId).toBeUndefined();
    });

    it('lists only the epics of the board', () => {
      useAppStore.setState({
        createModalOpen: true,
        tasks: { todo: [EPIC, { id: 't', title: 'Not an epic', type: 'chore', createdAt: '', updatedAt: '' }] },
      } as any);
      render(<CreateTaskModal />);
      const options = Array.from(screen.getByLabelText(/^epic$/i).querySelectorAll('option')).map((o) => o.textContent);
      expect(options).toEqual(['None', 'Checkout']);
    });
  });
});
