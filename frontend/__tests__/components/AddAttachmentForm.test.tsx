/**
 * Tests for AddAttachmentForm — files only, name = file basename.
 *
 * Covers:
 *  - Initial render: File path field + Browse (file) button, Cancel/Add (no name field)
 *  - Validation: path required + must be absolute, basename name-conflict
 *  - Happy-path submit: calls addUserAttachment({type:'file', name=basename}) + onSuccess
 *  - Escape key / Cancel button: call onCancel
 *  - disabled prop: input + buttons disabled, submit no-ops
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddAttachmentForm } from '../../src/components/board/AddAttachmentForm';
import { useAppStore } from '../../src/stores/useAppStore';

// DirectoryPicker imports these; stub so the module loads (picker isn't opened here).
vi.mock('../../src/api/client', () => ({
  getFsHome: vi.fn(),
  browseDirectory: vi.fn(),
}));

const DEFAULT_PROPS = {
  taskId: 'task-1',
  existingNames: [] as string[],
  disabled: false,
  onSuccess: vi.fn(),
  onCancel: vi.fn(),
};

let mockAdd: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockAdd = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({ addUserAttachment: mockAdd } as any);
  DEFAULT_PROPS.onSuccess = vi.fn();
  DEFAULT_PROPS.onCancel = vi.fn();
});

function setup(overrides = {}) {
  return render(<AddAttachmentForm {...DEFAULT_PROPS} {...overrides} />);
}

describe('AddAttachmentForm — files only', () => {
  it('renders a file path field + browse-for-file button + Add/Cancel, and NO name field', () => {
    setup();
    expect(screen.getByLabelText('File')).toBeInTheDocument();
    expect(screen.getByLabelText('Browse for file')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('does NOT offer link/note types (files only)', () => {
    setup();
    expect(screen.queryByText('Link')).not.toBeInTheDocument();
    expect(screen.queryByText('Note')).not.toBeInTheDocument();
  });

  it('requires a path', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/Pick a file or enter an absolute path/)).toBeInTheDocument();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('requires an absolute path', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'relative/path.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/Path must be absolute/)).toBeInTheDocument();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects when the file basename is already attached', async () => {
    setup({ existingNames: ['spec.md'] });
    fireEvent.change(screen.getByLabelText('File'), { target: { value: '/some/dir/spec.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/already attached/)).toBeInTheDocument();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('submits with name = basename and calls onSuccess', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('File'), { target: { value: '/Users/me/docs/spec.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith('task-1', {
      name: 'spec.md',
      type: 'file',
      content: '/Users/me/docs/spec.md',
    }));
    await waitFor(() => expect(DEFAULT_PROPS.onSuccess).toHaveBeenCalled());
  });

  it('Cancel button calls onCancel', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(DEFAULT_PROPS.onCancel).toHaveBeenCalled();
  });

  it('Escape key calls onCancel', () => {
    setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(DEFAULT_PROPS.onCancel).toHaveBeenCalled();
  });

  it('disabled prop disables the input and submit no-ops', () => {
    setup({ disabled: true });
    expect(screen.getByLabelText('File')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('File'), { target: { value: '/a/spec.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
