import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpaceModal } from '../../src/components/modals/SpaceModal';
import { useAppStore } from '../../src/stores/useAppStore';
import { getTasks, updateSpaceHooks, updateSpaceStatuses, validateDirectory } from '../../src/api/client';
import type { Space } from '../../src/types';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn().mockResolvedValue({}), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  validateDirectory: vi.fn().mockImplementation(async (p: string) => ({ path: p, isValid: true, isGitRepo: true })),
  updateSpaceHooks: vi.fn().mockResolvedValue({}),
  updateSpaceStatuses: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  useAppStore.setState({ ...useAppStore.getInitialState(), spaceModal: null, spaces: [] });
  vi.clearAllMocks();
});

// Not typed: the modal's delayed autofocus could take the focus midway.
function setCheckCommand(command: string) {
  fireEvent.change(screen.getByLabelText(/Check command/), { target: { value: command } });
}

describe('SpaceModal', () => {
  it('does not render when closed', () => {
    render(<SpaceModal />);
    expect(screen.queryByText('New space')).not.toBeInTheDocument();
  });

  it('renders create mode title', () => {
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' } });
    render(<SpaceModal />);
    expect(screen.getByText('New space')).toBeInTheDocument();
  });

  it('renders rename mode title', () => {
    const space = { id: 's1', name: 'Old Name', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    render(<SpaceModal />);
    expect(screen.getByText('Old Name settings')).toBeInTheDocument();
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
      // workingDirectory is empty → sent as ''
      expect(mockRename).toHaveBeenCalledWith('s1', 'New Name', '', undefined);
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
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('S', '/home/me/repo', undefined));
  });

  it('creates the space once the working directory checks out', async () => {
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' }, createSpace: mockCreate } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);
    fireEvent.change(screen.getByLabelText(/space name/i), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText(/working directory/i), { target: { value: '/repo' } });
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('S', '/repo', undefined));
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

  // ── Key ───────────────────────────────────────────────────────────────────

  describe('key', () => {
    const SPACE: Space = { id: 's1', name: 'Web', key: 'WEB', createdAt: '', updatedAt: '' };

    function openRename(mockRename = vi.fn().mockResolvedValue(undefined), space: Space = SPACE) {
      useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space }, renameSpace: mockRename, spaces: [space], closeSpaceModal: vi.fn() } as any);
      render(<SpaceModal />);
      return mockRename;
    }

    it('shows the key of the space, and uses it in the hint', () => {
      openRename();
      expect(screen.getByLabelText(/^key/i)).toHaveValue('WEB');
      expect(screen.getByText(/Issues are numbered WEB-1, WEB-2/)).toBeInTheDocument();
    });

    it('turns what is typed into capitals', () => {
      useAppStore.setState({ spaceModal: { open: true, mode: 'create' } });
      render(<SpaceModal />);
      fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: 'ab1' } });
      expect(screen.getByLabelText(/^key/i)).toHaveValue('AB1');
    });

    it('creates the space with the key', async () => {
      const mockCreate = vi.fn().mockResolvedValue(undefined);
      useAppStore.setState({ spaceModal: { open: true, mode: 'create' }, createSpace: mockCreate } as any);
      render(<SpaceModal />);
      fireEvent.change(screen.getByLabelText(/space name/i), { target: { value: 'S' } });
      fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: 'ops' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('S', undefined, 'OPS'));
    });

    it('saves a changed key', async () => {
      const mockRename = openRename();
      fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: 'SHOP' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mockRename).toHaveBeenCalledWith('s1', 'Web', '', 'SHOP'));
    });

    it.each(['A', '1AB', 'A-B'])('refuses the key %s without saving anything, and stays open', async (bad) => {
      const mockRename = openRename();
      fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: bad } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('A key has 2 to 10 capital letters');
      expect(mockRename).not.toHaveBeenCalled();
      expect(updateSpaceStatuses).not.toHaveBeenCalled();
      expect(updateSpaceHooks).not.toHaveBeenCalled();
      expect(useAppStore.getState().closeSpaceModal).not.toHaveBeenCalled();
    });

    it('clears the error when the key is edited', async () => {
      openRename();
      fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: 'A' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('alert');
      fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: 'AB' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows a key already taken under the key, and stays open', async () => {
      const taken = Object.assign(new Error('The key "SHOP" is or was used by another space.'), { code: 'DUPLICATE_KEY' });
      openRename(vi.fn().mockRejectedValue(taken));
      fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: 'SHOP' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('is or was used by another space');
      expect(screen.getByLabelText(/^key/i).parentElement).toContainElement(alert);
      expect(useAppStore.getState().closeSpaceModal).not.toHaveBeenCalled();
    });

    it('shows any other failure under the name, and stays open', async () => {
      openRename(vi.fn().mockRejectedValue(new Error('Server on fire')));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Server on fire');
      expect(screen.getByLabelText(/space name/i).parentElement).toContainElement(alert);
      expect(useAppStore.getState().closeSpaceModal).not.toHaveBeenCalled();
    });
  });

  // ── Statuses ──────────────────────────────────────────────────────────────

  describe('statuses', () => {
    const STATUSES = [
      { id: 'todo', name: 'Todo', category: 'todo' as const },
      { id: 'doing', name: 'Doing', category: 'in-progress' as const },
      { id: 'review', name: 'In review', category: 'in-progress' as const },
      { id: 'done', name: 'Done', category: 'done' as const },
    ];
    const SPACE: Space = { id: 's1', name: 'Web', key: 'WEB', statuses: STATUSES, finishStatusId: 'review', createdAt: '', updatedAt: '' };

    function openRename() {
      const mocks = {
        renameSpace: vi.fn().mockResolvedValue(undefined),
        loadSpaces: vi.fn().mockResolvedValue(undefined),
        closeSpaceModal: vi.fn(),
      };
      useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space: SPACE }, spaces: [SPACE], ...mocks } as any);
      render(<SpaceModal />);
      return mocks;
    }

    const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    it('has no statuses editor when creating a space', () => {
      useAppStore.setState({ spaceModal: { open: true, mode: 'create' } });
      render(<SpaceModal />);
      expect(screen.queryByTestId('statuses-editor')).not.toBeInTheDocument();
    });

    it('does not send the statuses when they did not change', async () => {
      const { renameSpace, closeSpaceModal } = openRename();
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      expect(updateSpaceStatuses).not.toHaveBeenCalled();
      await waitFor(() => expect(closeSpaceModal).toHaveBeenCalled());
    });

    it('sends a rename, trimmed, keeping the ids', async () => {
      const { loadSpaces, renameSpace } = openRename();
      fireEvent.change(screen.getByLabelText('Status name 2'), { target: { value: '  Building  ' } });
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      expect(updateSpaceStatuses).toHaveBeenCalledWith('s1', [
        STATUSES[0], { id: 'doing', name: 'Building', category: 'in-progress' }, STATUSES[2], STATUSES[3],
      ], {});
      expect(loadSpaces).toHaveBeenCalled();
    });

    it('sends the new order', async () => {
      const { renameSpace } = openRename();
      fireEvent.click(screen.getByRole('button', { name: 'Move Doing down' }));
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      expect(vi.mocked(updateSpaceStatuses).mock.calls[0][1].map((s) => s.id)).toEqual(['todo', 'review', 'doing', 'done']);
    });

    it('sends a new status without an id', async () => {
      const { renameSpace } = openRename();
      fireEvent.click(screen.getByTestId('add-status'));
      fireEvent.change(screen.getByLabelText('Status name 5'), { target: { value: 'QA' } });
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      expect(vi.mocked(updateSpaceStatuses).mock.calls[0][1][4]).toEqual({ name: 'QA', category: 'in-progress' });
    });

    it('asks where the issues go only for a removed status that has some, and sends the answer', async () => {
      vi.mocked(getTasks).mockResolvedValueOnce({ todo: [], doing: [{ id: 't' }] } as any);
      const { renameSpace } = openRename();
      await waitFor(() => expect(getTasks).toHaveBeenCalledWith('s1'));
      await screen.findByLabelText('Status name 1');

      fireEvent.click(screen.getByRole('button', { name: 'Remove Todo' }));
      expect(screen.queryByTestId('status-move')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Remove Doing' }));
      await waitFor(() => expect(screen.getByTestId('status-move')).toHaveTextContent('«Doing» is being removed. Move its 1 issue to'));

      fireEvent.change(screen.getByLabelText('Where the issues of Doing go'), { target: { value: 'done' } });
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      expect(updateSpaceStatuses).toHaveBeenCalledWith('s1', [STATUSES[2], STATUSES[3]], { doing: 'done' });
    });

    it('stays open with the reason when the server refuses the statuses, and changes nothing else', async () => {
      vi.mocked(updateSpaceStatuses).mockRejectedValueOnce(new Error('Wait for the running tasks to finish before changing this.'));
      const { renameSpace, loadSpaces, closeSpaceModal } = openRename();
      fireEvent.change(screen.getByLabelText('Status name 2'), { target: { value: 'Building' } });
      setCheckCommand('npm test');
      fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: 'SHOP' } });
      save();
      expect(await screen.findByRole('alert')).toHaveTextContent('Wait for the running tasks');
      expect(updateSpaceHooks).not.toHaveBeenCalled();
      expect(renameSpace).not.toHaveBeenCalled();
      expect(loadSpaces).not.toHaveBeenCalled();
      expect(closeSpaceModal).not.toHaveBeenCalled();
      // What was typed is still there to fix and save again.
      expect(screen.getByLabelText('Status name 2')).toHaveValue('Building');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('clears the reason when the statuses are edited', async () => {
      vi.mocked(updateSpaceStatuses).mockRejectedValueOnce(new Error('Each status needs a name'));
      openRename();
      fireEvent.change(screen.getByLabelText('Status name 2'), { target: { value: '' } });
      save();
      await screen.findByRole('alert');
      fireEvent.change(screen.getByLabelText('Status name 2'), { target: { value: 'Doing again' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('saves after fixing what the server refused', async () => {
      vi.mocked(updateSpaceStatuses).mockRejectedValueOnce(new Error('Each status needs a name'));
      const { renameSpace, closeSpaceModal } = openRename();
      fireEvent.change(screen.getByLabelText('Status name 2'), { target: { value: '' } });
      save();
      await screen.findByRole('alert');
      fireEvent.change(screen.getByLabelText('Status name 2'), { target: { value: 'Building' } });
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      await waitFor(() => expect(closeSpaceModal).toHaveBeenCalled());
    });

    // ── Finish status ───────────────────────────────────────────────────────

    it('shows where agents finish, among the saved statuses that are not to-do ones', () => {
      openRename();
      const select = screen.getByTestId('finish-status');
      expect(select).toHaveValue('review');
      expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Doing', 'In review', 'Done']);
    });

    it('has no finish status when creating a space', () => {
      useAppStore.setState({ spaceModal: { open: true, mode: 'create' } });
      render(<SpaceModal />);
      expect(screen.queryByTestId('finish-status')).not.toBeInTheDocument();
    });

    it('saves a new finish status with the hooks', async () => {
      const { renameSpace, loadSpaces } = openRename();
      fireEvent.change(screen.getByTestId('finish-status'), { target: { value: 'done' } });
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      expect(updateSpaceHooks).toHaveBeenCalledWith('s1', { checkCommand: null, autoPr: false, finishStatus: 'done' });
      expect(loadSpaces).toHaveBeenCalled();
    });

    it('does not send the finish status when it did not change', async () => {
      const { renameSpace } = openRename();
      setCheckCommand('npm test');
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      expect(updateSpaceHooks).toHaveBeenCalledWith('s1', { checkCommand: 'npm test', autoPr: false });
    });

    it('does not offer a status being removed, and does not send it', async () => {
      const { renameSpace } = openRename();
      fireEvent.click(screen.getByRole('button', { name: 'Remove In review' }));
      const options = Array.from(screen.getByTestId('finish-status').querySelectorAll('option')).map((o) => o.textContent);
      expect(options).toEqual(['Doing', 'Done']);
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      expect(updateSpaceHooks).not.toHaveBeenCalled();
    });

    it('forgets a new finish status when that status is then removed', async () => {
      const { renameSpace } = openRename();
      fireEvent.change(screen.getByTestId('finish-status'), { target: { value: 'doing' } });
      fireEvent.click(screen.getByRole('button', { name: 'Remove Doing' }));
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      expect(updateSpaceHooks).not.toHaveBeenCalled();
    });

    it('saves the statuses before the finish status, and stays open if it is refused', async () => {
      vi.mocked(updateSpaceHooks).mockRejectedValueOnce(new Error('finishStatus must be one of: todo'));
      const { renameSpace, loadSpaces, closeSpaceModal } = openRename();
      fireEvent.change(screen.getByLabelText('Status name 2'), { target: { value: 'Building' } });
      fireEvent.change(screen.getByTestId('finish-status'), { target: { value: 'done' } });
      save();
      expect(await screen.findByRole('alert')).toHaveTextContent('finishStatus must be one of');
      expect(vi.mocked(updateSpaceStatuses).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(updateSpaceHooks).mock.invocationCallOrder[0]);
      // The statuses did change, so the board must already show them.
      expect(loadSpaces).toHaveBeenCalled();
      expect(renameSpace).not.toHaveBeenCalled();
      expect(closeSpaceModal).not.toHaveBeenCalled();
    });

    // Fails today: spaceModal.space stays the copy from when the form opened, so the second
    // Save sends QA as new again, and the server removes the first QA and creates another.
    it('does not create a new status twice when saving again after a refusal', async () => {
      vi.mocked(updateSpaceHooks).mockRejectedValueOnce(new Error('Wait for the running tasks'));
      const { renameSpace } = openRename();
      fireEvent.click(screen.getByTestId('add-status'));
      fireEvent.change(screen.getByLabelText('Status name 5'), { target: { value: 'QA' } });
      setCheckCommand('npm test');
      save();
      await screen.findByRole('alert');
      save();
      await waitFor(() => expect(renameSpace).toHaveBeenCalled());
      const sentAgain = vi.mocked(updateSpaceStatuses).mock.calls.slice(1).flatMap(([, statuses]) => statuses);
      expect(sentAgain.filter((s) => s.name === 'QA' && !s.id)).toEqual([]);
    });
  });
});
