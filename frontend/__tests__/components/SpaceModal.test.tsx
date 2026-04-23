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
      // workingDirectory is empty → sent as ''; pipeline empty → []; nicknames empty → {}
      expect(mockRename).toHaveBeenCalledWith('s1', 'New Name', '', [], {});
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

// ---------------------------------------------------------------------------
// Agent Nicknames section tests
// ---------------------------------------------------------------------------

describe('SpaceModal — Agent Nicknames section', () => {
  it('does NOT show nicknames section in create mode', () => {
    useAppStore.setState({ spaceModal: { open: true, mode: 'create' } });
    render(<SpaceModal />);
    expect(screen.queryByText(/agent nicknames/i)).not.toBeInTheDocument();
  });

  it('shows nicknames section header in rename mode', () => {
    const space = { id: 's1', name: 'My Space', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    render(<SpaceModal />);
    expect(screen.getByText(/agent nicknames/i)).toBeInTheDocument();
  });

  it('nicknames section is collapsed by default', () => {
    const space = { id: 's1', name: 'My Space', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    render(<SpaceModal />);
    // Inputs are only visible when expanded — none visible when collapsed
    expect(screen.queryByPlaceholderText(/e\.g\. El Jefe/i)).not.toBeInTheDocument();
  });

  it('clicking the header toggles the section open', async () => {
    const space = { id: 's1', name: 'My Space', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    const user = userEvent.setup();
    render(<SpaceModal />);

    await user.click(screen.getByRole('button', { name: /agent nicknames/i }));
    expect(screen.getAllByPlaceholderText(/e\.g\. El Jefe/i).length).toBeGreaterThan(0);
  });

  it('clicking the header again collapses the section', async () => {
    const space = { id: 's1', name: 'My Space', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    const user = userEvent.setup();
    render(<SpaceModal />);

    const header = screen.getByRole('button', { name: /agent nicknames/i });
    await user.click(header); // open
    await user.click(header); // close
    expect(screen.queryByPlaceholderText(/e\.g\. El Jefe/i)).not.toBeInTheDocument();
  });

  it('pre-fills nickname inputs from space.agentNicknames', async () => {
    const space = {
      id: 's1',
      name: 'My Space',
      createdAt: '',
      updatedAt: '',
      agentNicknames: { 'senior-architect': 'El Jefe' },
    };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    const user = userEvent.setup();
    render(<SpaceModal />);

    await user.click(screen.getByRole('button', { name: /agent nicknames/i }));
    expect(screen.getByDisplayValue('El Jefe')).toBeInTheDocument();
  });

  it('submitting with a nickname calls renameSpace with the correct agentNicknames map', async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    const space = { id: 's1', name: 'My Space', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space }, renameSpace: mockRename } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);

    // Open nicknames section
    await user.click(screen.getByRole('button', { name: /agent nicknames/i }));

    // Type a nickname for senior-architect (first input)
    const inputs = screen.getAllByPlaceholderText(/e\.g\. El Jefe/i);
    await user.type(inputs[0], 'El Jefe');

    // Submit
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockRename).toHaveBeenCalled();
      const callArgs = mockRename.mock.calls[0];
      // 5th argument is the agentNicknames map
      const nicknames = callArgs[4];
      expect(typeof nicknames).toBe('object');
      // At least one entry should contain 'El Jefe'
      expect(Object.values(nicknames)).toContain('El Jefe');
    });
  });

  it('"Clear all nicknames" resets all inputs to empty without closing the modal', async () => {
    const space = {
      id: 's1',
      name: 'My Space',
      createdAt: '',
      updatedAt: '',
      agentNicknames: { 'senior-architect': 'El Jefe', 'developer-agent': 'Rafa' },
    };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    const user = userEvent.setup();
    render(<SpaceModal />);

    await user.click(screen.getByRole('button', { name: /agent nicknames/i }));

    // Verify pre-filled values are present
    expect(screen.getByDisplayValue('El Jefe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Rafa')).toBeInTheDocument();

    // Click clear all
    await user.click(screen.getByRole('button', { name: /clear all nicknames/i }));

    // All inputs should now be empty
    const inputs = screen.getAllByPlaceholderText(/e\.g\. El Jefe/i);
    for (const input of inputs) {
      expect((input as HTMLInputElement).value).toBe('');
    }

    // Modal should still be open
    expect(screen.getByText('Rename Space')).toBeInTheDocument();
  });

  it('shows inline validation error for nickname > 50 chars and blocks submit', async () => {
    const mockRename = vi.fn().mockResolvedValue(undefined);
    const space = { id: 's1', name: 'My Space', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space }, renameSpace: mockRename } as any);
    const user = userEvent.setup();
    render(<SpaceModal />);

    // Open the nicknames section via its accessible button
    const toggleBtn = screen.getByRole('button', { name: /agent nicknames/i });
    await user.click(toggleBtn);

    // Click the first nickname input to ensure focus, then clear it and type 51 chars
    // (maxLength is 51 so jsdom accepts it; validation checks > 50 and fails)
    const inputs = screen.getAllByPlaceholderText(/e\.g\. El Jefe/i) as HTMLInputElement[];
    await user.click(inputs[0]);
    fireEvent.change(inputs[0], { target: { value: 'a'.repeat(51) } });

    // Trigger validation by clicking Save
    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    await user.click(saveBtn);

    // The modal should remain open (renameSpace not called)
    expect(mockRename).not.toHaveBeenCalled();

    // The error should be visible somewhere in the document (portal renders to body)
    await waitFor(() => {
      const alerts = document.body.querySelectorAll('[role="alert"]');
      const hasNicknameError = Array.from(alerts).some((el) =>
        /max 50/i.test(el.textContent ?? '')
      );
      expect(hasNicknameError).toBe(true);
    });
  });

  it('each input has an accessible label with htmlFor', async () => {
    const space = { id: 's1', name: 'My Space', createdAt: '', updatedAt: '' };
    useAppStore.setState({ spaceModal: { open: true, mode: 'rename', space } });
    const user = userEvent.setup();
    render(<SpaceModal />);

    await user.click(screen.getByRole('button', { name: /agent nicknames/i }));

    // All inputs rendered should have an id that matches a label's htmlFor
    const inputs = screen.getAllByPlaceholderText(/e\.g\. El Jefe/i) as HTMLInputElement[];
    for (const input of inputs) {
      const id = input.id;
      expect(id).not.toBe('');
      expect(document.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
  });
});
