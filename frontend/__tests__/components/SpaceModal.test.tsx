import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpaceModal } from '../../src/components/modals/SpaceModal';
import { useAppStore } from '../../src/stores/useAppStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

beforeEach(() => {
  useAppStore.setState({ spaceModal: null });
  vi.clearAllMocks();
});

describe('SpaceModal', () => {
  it('does not render when closed', () => {
    render(<SpaceModal />);
    expect(screen.queryByText('New Space')).not.toBeInTheDocument();
  });

  it('renders create mode title', () => {
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' } });
    render(<SpaceModal />);
    expect(screen.getByText('New Space')).toBeInTheDocument();
  });

  it('renders rename mode title', () => {
    const space = { id: 's1', name: 'Old Name', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    render(<SpaceModal />);
    expect(screen.getByText('Rename Space')).toBeInTheDocument();
  });

  it('pre-fills name input in rename mode', () => {
    const space = { id: 's1', name: 'Existing Space', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    render(<SpaceModal />);
    expect(screen.getByDisplayValue('Existing Space')).toBeInTheDocument();
  });

  it('shows validation error when submitting empty name', async () => {
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' } });
    render(<SpaceModal />);

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByText('Space name is required.')).toBeInTheDocument();
    });
  });

  it('calls createSpace action on submit in create mode', async () => {
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' }, createSpace: mockCreate } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);

    await user.type(screen.getByLabelText(/space name/i), 'My New Space');
    await user.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith('My New Space', undefined, undefined);
    });
  });

  it('calls renameSpace action on submit in rename mode', async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    const space = { id: 's1', name: 'Old', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space }, renameSpace: mockRename } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);

    await user.clear(screen.getByLabelText(/space name/i));
    await user.type(screen.getByLabelText(/space name/i), 'New Name');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      // workingDirectory is empty → wd=undefined → sent as '' via wd??''; pipeline empty → []
      expect(mockRename).toHaveBeenCalledWith('s1', 'New Name', '', []);
    });
  });

  it('submits on Enter key press', async () => {
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' }, createSpace: mockCreate } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);

    const input = screen.getByLabelText(/space name/i);
    await user.type(input, 'Test Space');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith('Test Space', undefined, undefined);
    });
  });
});
