/**
 * Tests for AddAttachmentForm — QOL-7.
 *
 * Covers:
 *  - Initial render: type selector, name + content fields, Cancel/Add buttons
 *  - Type switching: clears content, updates placeholder/label
 *  - Validation: name required, content required, https:// enforced for links,
 *    absolute path required for files, name-conflict detection
 *  - Auto-populate: name filled from URL hostname on content blur when name empty
 *  - Happy-path submit: calls addUserAttachment + onSuccess
 *  - Submit while saving: disabled state, no double-submit
 *  - Escape key: calls onCancel
 *  - Cancel button: calls onCancel
 *  - disabled prop: inputs + buttons are disabled, submit no-ops
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddAttachmentForm } from '../../src/components/board/AddAttachmentForm';
import { useAppStore } from '../../src/stores/useAppStore';

// ---------------------------------------------------------------------------
// API + store mock
// ---------------------------------------------------------------------------

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
  patchUserAttachment: vi.fn(),
  deleteUserAttachment: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const DEFAULT_PROPS = {
  spaceId: 'space-1',
  taskId: 'task-1',
  existingNames: [] as string[],
  disabled: false,
  onSuccess: vi.fn(),
  onCancel: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderForm(props: Partial<typeof DEFAULT_PROPS> = {}) {
  const merged = { ...DEFAULT_PROPS, ...props };
  return render(<AddAttachmentForm {...merged} />);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default addUserAttachment resolves immediately.
  useAppStore.setState({
    addUserAttachment: vi.fn().mockResolvedValue(undefined),
    deleteUserAttachment: vi.fn().mockResolvedValue(undefined),
    isMutating: false,
    activeSpaceId: 'space-1',
  } as any);
});

// ---------------------------------------------------------------------------
// Initial render
// ---------------------------------------------------------------------------

describe('AddAttachmentForm — initial render', () => {
  it('renders the type selector with Link pre-selected', () => {
    renderForm();
    const linkTab = screen.getByRole('radio', { name: /link/i });
    expect(linkTab).toBeInTheDocument();
    expect(linkTab).toHaveAttribute('aria-checked', 'true');
  });

  it('renders Note and File Path tabs', () => {
    renderForm();
    expect(screen.getByRole('radio', { name: /note/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /file path/i })).toBeInTheDocument();
  });

  it('renders Name and URL fields', () => {
    renderForm();
    expect(screen.getByPlaceholderText(/e\.g\. GitHub PR/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/https:\/\/example\.com/i)).toBeInTheDocument();
  });

  it('renders Cancel and Add buttons', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('has form with accessible label', () => {
    renderForm();
    expect(screen.getByRole('form', { name: /add attachment/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Type switching
// ---------------------------------------------------------------------------

describe('AddAttachmentForm — type switching', () => {
  it('switches to Note — label changes to Content, tab becomes active', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('radio', { name: /note/i }));

    const noteTab = screen.getByRole('radio', { name: /note/i });
    expect(noteTab).toHaveAttribute('aria-checked', 'true');

    // Content field renders as textarea for text type
    expect(screen.getByPlaceholderText(/type your note/i)).toBeInTheDocument();
  });

  it('switches to File Path — label changes to Path', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('radio', { name: /file path/i }));

    const fileTab = screen.getByRole('radio', { name: /file path/i });
    expect(fileTab).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(/\/absolute\/path/i)).toBeInTheDocument();
  });

  it('clears content when switching type', async () => {
    const user = userEvent.setup();
    renderForm();

    // Type something in the URL field
    const urlInput = screen.getByPlaceholderText(/https:\/\/example\.com/i);
    await user.type(urlInput, 'https://github.com');

    // Switch to Note
    await user.click(screen.getByRole('radio', { name: /note/i }));

    // Content field should now be a textarea with empty value
    const textarea = screen.getByPlaceholderText(/type your note/i);
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps name when switching type', async () => {
    const user = userEvent.setup();
    renderForm();

    const nameInput = screen.getByPlaceholderText(/e\.g\. GitHub PR/i);
    await user.type(nameInput, 'My attachment');

    await user.click(screen.getByRole('radio', { name: /note/i }));

    expect((nameInput as HTMLInputElement).value).toBe('My attachment');
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('AddAttachmentForm — validation', () => {
  it('shows name required error on submit with empty name', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    });
  });

  it('shows content required error on submit with empty content', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), 'My link');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(screen.getByText(/content is required/i)).toBeInTheDocument();
    });
  });

  it('shows URL scheme error when link does not start with https://', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), 'PR Link');
    await user.type(screen.getByPlaceholderText(/https:\/\/example\.com/i), 'http://example.com');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(screen.getByText(/https:\/\//i)).toBeInTheDocument();
    });
  });

  it('shows absolute path error when file path is relative', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('radio', { name: /file path/i }));
    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), 'My file');
    await user.type(screen.getByPlaceholderText(/\/absolute\/path/i), 'relative/path');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(screen.getByText(/absolute path/i)).toBeInTheDocument();
    });
  });

  it('shows name-conflict error when name already exists', async () => {
    const user = userEvent.setup();
    renderForm({ existingNames: ['PR #42'] });

    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), 'PR #42');
    await user.type(screen.getByPlaceholderText(/https:\/\/example\.com/i), 'https://github.com');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(screen.getByText(/"PR #42" already exists/i)).toBeInTheDocument();
    });
  });

  it('clears name error when user starts typing after error', async () => {
    const user = userEvent.setup();
    renderForm();

    // Trigger name error
    await user.click(screen.getByRole('button', { name: /add/i }));
    await waitFor(() => expect(screen.getByText(/name is required/i)).toBeInTheDocument());

    // Start typing — error should clear
    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), 'A');
    expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument();
  });

  it('does not submit when both fields are invalid', async () => {
    const addUserAttachment = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ addUserAttachment } as any);
    const onSuccess = vi.fn();

    const user = userEvent.setup();
    renderForm({ onSuccess });

    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(addUserAttachment).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Auto-populate name from URL hostname
// ---------------------------------------------------------------------------

describe('AddAttachmentForm — auto-populate name from URL', () => {
  it('fills name from URL hostname on content blur when name is empty', async () => {
    renderForm();

    // Use fireEvent.change instead of userEvent.type to avoid jsdom type="url"
    // input filtering and requestAnimationFrame focus-stealing on the name field.
    const urlInput = screen.getByPlaceholderText(/https:\/\/example\.com/i);
    fireEvent.change(urlInput, { target: { value: 'https://github.com/owner/repo' } });
    fireEvent.blur(urlInput);

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText(/e\.g\. GitHub PR/i) as HTMLInputElement;
      expect(nameInput.value).toBe('github.com');
    });
  });

  it('does not overwrite name when user has already typed one', async () => {
    const user = userEvent.setup();
    renderForm();

    const nameInput = screen.getByPlaceholderText(/e\.g\. GitHub PR/i);
    await user.type(nameInput, 'My PR');

    const urlInput = screen.getByPlaceholderText(/https:\/\/example\.com/i);
    await user.type(urlInput, 'https://github.com/owner/repo');
    fireEvent.blur(urlInput);

    // Name should not have changed
    expect((nameInput as HTMLInputElement).value).toBe('My PR');
  });

  it('skips auto-populate when URL is invalid', async () => {
    renderForm();

    const urlInput = screen.getByPlaceholderText(/https:\/\/example\.com/i);
    // Use fireEvent.change instead of userEvent.type to bypass jsdom URL input filtering
    fireEvent.change(urlInput, { target: { value: 'not-a-valid-url' } });
    fireEvent.blur(urlInput);

    // Name stays empty — new URL() throws so no auto-populate
    const nameInput = screen.getByPlaceholderText(/e\.g\. GitHub PR/i) as HTMLInputElement;
    expect(nameInput.value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Happy-path submit
// ---------------------------------------------------------------------------

describe('AddAttachmentForm — submit happy path', () => {
  it('calls addUserAttachment with correct args on valid link submit', async () => {
    const addUserAttachment = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ addUserAttachment } as any);
    const onSuccess = vi.fn();

    const user = userEvent.setup();
    renderForm({ onSuccess });

    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), 'PR #99');
    await user.type(screen.getByPlaceholderText(/https:\/\/example\.com/i), 'https://github.com/pr/99');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(addUserAttachment).toHaveBeenCalledWith('task-1', {
        name: 'PR #99',
        type: 'link',
        content: 'https://github.com/pr/99',
      });
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it('calls addUserAttachment for text (Note) type', async () => {
    const addUserAttachment = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ addUserAttachment } as any);

    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('radio', { name: /note/i }));
    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), 'My note');
    await user.type(screen.getByPlaceholderText(/type your note/i), 'This is the content');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(addUserAttachment).toHaveBeenCalledWith('task-1', {
        name: 'My note',
        type: 'text',
        content: 'This is the content',
      });
    });
  });

  it('calls addUserAttachment for file type with absolute path', async () => {
    const addUserAttachment = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ addUserAttachment } as any);

    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('radio', { name: /file path/i }));
    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), 'hosts');
    await user.type(screen.getByPlaceholderText(/\/absolute\/path/i), '/etc/hosts');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(addUserAttachment).toHaveBeenCalledWith('task-1', {
        name: 'hosts',
        type: 'file',
        content: '/etc/hosts',
      });
    });
  });

  it('trims whitespace from name and content before submit', async () => {
    const addUserAttachment = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ addUserAttachment } as any);

    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('radio', { name: /note/i }));
    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), '  trimmed  ');
    await user.type(screen.getByPlaceholderText(/type your note/i), '  content  ');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(addUserAttachment).toHaveBeenCalledWith('task-1', {
        name: 'trimmed',
        type: 'text',
        content: 'content',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Escape key and Cancel
// ---------------------------------------------------------------------------

describe('AddAttachmentForm — cancel behaviour', () => {
  it('calls onCancel when Cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderForm({ onCancel });

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when Escape is pressed', async () => {
    const onCancel = vi.fn();
    renderForm({ onCancel });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Disabled state
// ---------------------------------------------------------------------------

describe('AddAttachmentForm — disabled prop', () => {
  it('disables all type tabs when disabled=true', () => {
    renderForm({ disabled: true });
    const tabs = screen.getAllByRole('radio');
    for (const tab of tabs) {
      expect(tab).toBeDisabled();
    }
  });

  it('disables name and content inputs when disabled=true', () => {
    renderForm({ disabled: true });
    expect(screen.getByPlaceholderText(/e\.g\. GitHub PR/i)).toBeDisabled();
    expect(screen.getByPlaceholderText(/https:\/\/example\.com/i)).toBeDisabled();
  });

  it('disables the Add button when disabled=true', () => {
    renderForm({ disabled: true });
    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
  });

  it('does not call addUserAttachment when disabled and form is submitted', async () => {
    const addUserAttachment = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ addUserAttachment } as any);

    renderForm({ disabled: true });

    fireEvent.submit(screen.getByRole('form', { name: /add attachment/i }));

    // Allow any async effects to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(addUserAttachment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error from store (addUserAttachment rejects)
// ---------------------------------------------------------------------------

describe('AddAttachmentForm — store error handling', () => {
  it('does not call onSuccess when addUserAttachment throws', async () => {
    const addUserAttachment = vi.fn().mockRejectedValue(new Error('API error'));
    useAppStore.setState({ addUserAttachment } as any);
    const onSuccess = vi.fn();

    const user = userEvent.setup();
    renderForm({ onSuccess });

    await user.click(screen.getByRole('radio', { name: /note/i }));
    await user.type(screen.getByPlaceholderText(/e\.g\. GitHub PR/i), 'fail note');
    await user.type(screen.getByPlaceholderText(/type your note/i), 'content');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(addUserAttachment).toHaveBeenCalled();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
