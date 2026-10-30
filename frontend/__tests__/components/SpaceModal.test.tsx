import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpaceModal } from '../../src/components/modals/SpaceModal';
import { useAppStore } from '../../src/stores/useAppStore';
import { updateSpaceHooks, validateDirectory } from '../../src/api/client';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  validateDirectory: vi.fn().mockImplementation(async (p: string) => ({ path: p, isValid: true, isGitRepo: true })),
  updateSpaceHooks: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  useAppStore.setState({ spaceModal: null, spaces: [] });
  vi.clearAllMocks();
});

// Not typed: the modal's delayed autofocus could take the focus midway.
function setCheckCommand(command: string) {
  fireEvent.change(screen.getByLabelText(/Check command/), { target: { value: command } });
}

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
    expect(screen.getByText('Edit Space')).toBeInTheDocument();
  });

  it('pre-fills name input in rename mode', () => {
    const space = { id: 's1', name: 'Existing Space', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    render(<SpaceModal />);
    expect(screen.getByDisplayValue('Existing Space')).toBeInTheDocument();
  });

  it('pre-fills workingDirectory input in rename mode', () => {
    const space = { id: 's1', name: 'Space', workingDirectory: '/my/project', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    render(<SpaceModal />);
    expect(screen.getByDisplayValue('/my/project')).toBeInTheDocument();
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
      expect(mockCreate).toHaveBeenCalledWith('My New Space', undefined);
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
      // workingDirectory is empty → sent as ''
      expect(mockRename).toHaveBeenCalledWith('s1', 'New Name', '');
    });
  });

  it('saves the check with the rest of the space', async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    const space = { id: 's1', name: 'Old', createdAt: '', updatedAt: '' };
    const mockLoad = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space }, renameSpace: mockRename, loadSpaces: mockLoad, spaces: [space] } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);
    setCheckCommand('  npm test  ');
    fireEvent.click(screen.getByLabelText('Open a pull request automatically'));
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(mockRename).toHaveBeenCalled());
    expect(updateSpaceHooks).toHaveBeenCalledWith('s1', { checkCommand: 'npm test', autoPr: true });
    expect(mockLoad).toHaveBeenCalled();
  });

  it('does not touch the check when it did not change', async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    const space = { id: 's1', name: 'Old', hooks: { checkCommand: 'x', autoPr: false }, createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space }, renameSpace: mockRename, spaces: [space] } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(mockRename).toHaveBeenCalled());
    expect(updateSpaceHooks).not.toHaveBeenCalled();
  });

  it('stays open with the reason when the server refuses the check', async () => {
    vi.mocked(updateSpaceHooks).mockRejectedValueOnce(new Error('Wait for the running tasks'));
    const mockRename = vi.fn();
    const space = { id: 's1', name: 'Old', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space }, renameSpace: mockRename } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);
    setCheckCommand('x');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wait for the running tasks'));
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('treats an older list of hooks as no check', async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    const space = { id: 's1', name: 'Old', hooks: [{ name: 'CI', command: 'x' }], createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space }, renameSpace: mockRename, spaces: [space] } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);
    expect(screen.getByLabelText(/Check command/)).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(mockRename).toHaveBeenCalled());
    expect(updateSpaceHooks).not.toHaveBeenCalled();
  });

  it('has no check settings in create mode', () => {
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' } });
    render(<SpaceModal />);
    expect(screen.queryByLabelText(/Check command/)).toBeNull();
  });

  it('checks the working directory on save, and stays open if it is not valid', async () => {
    vi.mocked(validateDirectory).mockRejectedValueOnce(new Error('Path does not exist: /nope'));
    const mockCreate = vi.fn();
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' }, createSpace: mockCreate } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);
    fireEvent.change(screen.getByLabelText(/space name/i), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText(/working directory/i), { target: { value: '/nope' } });
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Path does not exist'));
    expect(validateDirectory).toHaveBeenCalledWith('/nope');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a folder that is not a git repository', async () => {
    vi.mocked(validateDirectory).mockResolvedValueOnce({ path: '/plain', isValid: true, isGitRepo: false });
    const mockCreate = vi.fn();
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' }, createSpace: mockCreate } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);
    fireEvent.change(screen.getByLabelText(/space name/i), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText(/working directory/i), { target: { value: '/plain' } });
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not a git repository'));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('saves the path the server resolved, not what was typed', async () => {
    vi.mocked(validateDirectory).mockResolvedValueOnce({ path: '/home/me/repo', isValid: true, isGitRepo: true });
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' }, createSpace: mockCreate } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);
    fireEvent.change(screen.getByLabelText(/space name/i), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText(/working directory/i), { target: { value: '~/repo' } });
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('S', '/home/me/repo'));
  });

  it('creates the space once the working directory checks out', async () => {
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' }, createSpace: mockCreate } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);
    fireEvent.change(screen.getByLabelText(/space name/i), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText(/working directory/i), { target: { value: '/repo' } });
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('S', '/repo'));
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
      expect(mockCreate).toHaveBeenCalledWith('Test Space', undefined);
    });
  });
});
