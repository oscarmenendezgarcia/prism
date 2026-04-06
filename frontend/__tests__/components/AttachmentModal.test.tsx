import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttachmentModal } from '../../src/components/modals/AttachmentModal';
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

const mockGetAttachmentContent = vi.mocked(api.getAttachmentContent);

const SINGLE_ATTACHMENT = [{ name: 'notes.txt', type: 'text' as const }];

const BASE_MODAL = {
  open: true,
  spaceId: 'space-1',
  taskId: 'task-1',
  index: 0,
  name: 'notes.txt',
  attachments: SINGLE_ATTACHMENT,
};

beforeEach(() => {
  useAppStore.setState({ attachmentModal: null });
  vi.clearAllMocks();
  // clipboard mock
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

describe('AttachmentModal — closed state', () => {
  it('renders nothing when modal is null', () => {
    render(<AttachmentModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing when open is false', () => {
    useAppStore.setState({ attachmentModal: { ...BASE_MODAL, open: false } });
    render(<AttachmentModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AttachmentModal — loading state', () => {
  it('shows loading spinner and "Loading content..." text', async () => {
    // Never resolves so we stay in loading state
    mockGetAttachmentContent.mockReturnValue(new Promise(() => {}));
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    expect(screen.getByText('Loading content...')).toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
  });
});

describe('AttachmentModal — content state (text type)', () => {
  it('renders file content inside a <pre> block', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'notes.txt',
      type: 'text',
      content: 'hello world',
    });
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => {
      expect(screen.getByText('hello world')).toBeInTheDocument();
    });
  });

  it('does not render source banner for text-type attachment', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'notes.txt',
      type: 'text',
      content: 'data',
    });
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => {
      expect(screen.getByText('data')).toBeInTheDocument();
    });
    expect(screen.queryByText('Source File Path')).not.toBeInTheDocument();
  });

  it('renders Close and Copy buttons', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'notes.txt',
      type: 'text',
      content: 'content',
    });
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => {
      // Use getByText to avoid ambiguity with the modal header "Close modal" icon button
      expect(screen.getByText('Close')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    });
  });

  it('Copy button writes content to clipboard', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'notes.txt',
      type: 'text',
      content: 'copy me',
    });
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('Copy'));
    fireEvent.click(screen.getByText('Copy'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy me');
  });
});

describe('AttachmentModal — content state (file type with source)', () => {
  it('renders source file path banner when type is file and source is present', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'migrator.test.js',
      type: 'file',
      content: 'test content',
      source: '/home/user/tests/migrator.test.js',
    });
    useAppStore.setState({ attachmentModal: { ...BASE_MODAL, name: 'migrator.test.js', attachments: [{ name: 'migrator.test.js', type: 'file' }] } });

    render(<AttachmentModal />);

    await waitFor(() => {
      expect(screen.getByText('Source File Path')).toBeInTheDocument();
      expect(screen.getByText('/home/user/tests/migrator.test.js')).toBeInTheDocument();
    });
  });

  it('does not render source banner when source field is absent', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'migrator.test.js',
      type: 'file',
      content: 'test content',
    });
    useAppStore.setState({ attachmentModal: { ...BASE_MODAL, name: 'migrator.test.js', attachments: [{ name: 'migrator.test.js', type: 'file' }] } });

    render(<AttachmentModal />);

    await waitFor(() => {
      expect(screen.getByText('test content')).toBeInTheDocument();
    });
    expect(screen.queryByText('Source File Path')).not.toBeInTheDocument();
  });
});

describe('AttachmentModal — error state', () => {
  it('renders error UI for generic error', async () => {
    mockGetAttachmentContent.mockRejectedValue(new Error('Network error'));
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  it('maps 404 error to english message', async () => {
    mockGetAttachmentContent.mockRejectedValue(new Error('HTTP 404'));
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => {
      expect(screen.getByText('Attachment not found')).toBeInTheDocument();
      expect(screen.getByText('Error 404')).toBeInTheDocument();
    });
  });

  it('maps "does not exist on disk" error', async () => {
    mockGetAttachmentContent.mockRejectedValue(new Error('does not exist on disk'));
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => {
      expect(screen.getByText('File not found on disk')).toBeInTheDocument();
      expect(screen.getByText('Error 422')).toBeInTheDocument();
    });
  });

  it('maps "exceeds the 5 MB" error', async () => {
    mockGetAttachmentContent.mockRejectedValue(new Error('exceeds the 5 MB limit'));
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => {
      expect(screen.getByText('File is too large to display')).toBeInTheDocument();
      expect(screen.getByText('Error 413')).toBeInTheDocument();
    });
  });

  it('shows english description and action text in error state', async () => {
    mockGetAttachmentContent.mockRejectedValue(new Error('HTTP 404'));
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => {
      expect(
        screen.getByText('The file referenced by this attachment could not be loaded from the server.')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Contact the agent that created this attachment to re-upload it.')
      ).toBeInTheDocument();
    });
  });

  it('error state Close button calls closeAttachmentModal', async () => {
    mockGetAttachmentContent.mockRejectedValue(new Error('HTTP 404'));
    const mockClose = vi.fn();
    useAppStore.setState({ attachmentModal: BASE_MODAL, closeAttachmentModal: mockClose } as any);

    render(<AttachmentModal />);

    // Wait for error state to render (has a "Close" text button at bottom of error state)
    await waitFor(() => screen.getByText('Close'));
    fireEvent.click(screen.getByText('Close'));

    expect(mockClose).toHaveBeenCalled();
  });
});

describe('AttachmentModal — close interactions', () => {
  it('Close button in content state calls closeAttachmentModal', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'notes.txt',
      type: 'text',
      content: 'content',
    });
    const mockClose = vi.fn();
    useAppStore.setState({ attachmentModal: BASE_MODAL, closeAttachmentModal: mockClose } as any);

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('Close'));
    fireEvent.click(screen.getByText('Close'));

    expect(mockClose).toHaveBeenCalled();
  });

  it('resets to loading state when modal re-opens for a different attachment', async () => {
    mockGetAttachmentContent
      .mockResolvedValueOnce({ name: 'a.txt', type: 'text', content: 'first' })
      .mockReturnValueOnce(new Promise(() => {})); // second stays loading

    useAppStore.setState({ attachmentModal: BASE_MODAL });
    const { rerender } = render(<AttachmentModal />);

    await waitFor(() => screen.getByText('first'));

    useAppStore.setState({
      attachmentModal: { ...BASE_MODAL, index: 1, name: 'b.txt', attachments: [{ name: 'a.txt', type: 'text' }, { name: 'b.txt', type: 'text' }] },
    });
    rerender(<AttachmentModal />);

    await waitFor(() => {
      expect(screen.getByText('Loading content...')).toBeInTheDocument();
    });
  });
});

describe('AttachmentModal — single attachment (no navigation)', () => {
  it('does not render prev/next buttons when only one attachment', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'notes.txt',
      type: 'text',
      content: 'content',
    });
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('content'));

    expect(screen.queryByRole('button', { name: /previous attachment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next attachment/i })).not.toBeInTheDocument();
  });

  it('does not show position indicator when only one attachment', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'notes.txt',
      type: 'text',
      content: 'content',
    });
    useAppStore.setState({ attachmentModal: BASE_MODAL });

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('content'));

    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
  });
});

describe('AttachmentModal — multi-attachment navigation', () => {
  const THREE_ATTACHMENTS = [
    { name: 'a.txt', type: 'text' as const },
    { name: 'b.txt', type: 'text' as const },
    { name: 'c.txt', type: 'text' as const },
  ];

  it('shows position indicator "1 / 3" when on first of three attachments', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'a.txt',
      type: 'text',
      content: 'first',
    });
    useAppStore.setState({
      attachmentModal: { open: true, spaceId: 'space-1', taskId: 'task-1', index: 0, name: 'a.txt', attachments: THREE_ATTACHMENTS },
    });

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('first'));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('renders prev and next buttons when multiple attachments', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'b.txt',
      type: 'text',
      content: 'middle',
    });
    useAppStore.setState({
      attachmentModal: { open: true, spaceId: 'space-1', taskId: 'task-1', index: 1, name: 'b.txt', attachments: THREE_ATTACHMENTS },
    });

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('middle'));
    expect(screen.getByRole('button', { name: /previous attachment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next attachment/i })).toBeInTheDocument();
  });

  it('prev button is disabled on the first attachment', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'a.txt',
      type: 'text',
      content: 'first',
    });
    useAppStore.setState({
      attachmentModal: { open: true, spaceId: 'space-1', taskId: 'task-1', index: 0, name: 'a.txt', attachments: THREE_ATTACHMENTS },
    });

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('first'));
    expect(screen.getByRole('button', { name: /previous attachment/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next attachment/i })).not.toBeDisabled();
  });

  it('next button is disabled on the last attachment', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'c.txt',
      type: 'text',
      content: 'last',
    });
    useAppStore.setState({
      attachmentModal: { open: true, spaceId: 'space-1', taskId: 'task-1', index: 2, name: 'c.txt', attachments: THREE_ATTACHMENTS },
    });

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('last'));
    expect(screen.getByRole('button', { name: /previous attachment/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /next attachment/i })).toBeDisabled();
  });

  it('clicking next calls openAttachmentModal with incremented index', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'a.txt',
      type: 'text',
      content: 'first',
    });
    const mockOpen = vi.fn();
    useAppStore.setState({
      attachmentModal: { open: true, spaceId: 'space-1', taskId: 'task-1', index: 0, name: 'a.txt', attachments: THREE_ATTACHMENTS },
      openAttachmentModal: mockOpen,
    } as any);

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('first'));
    fireEvent.click(screen.getByRole('button', { name: /next attachment/i }));

    expect(mockOpen).toHaveBeenCalledWith('space-1', 'task-1', 1, 'b.txt', THREE_ATTACHMENTS);
  });

  it('clicking prev calls openAttachmentModal with decremented index', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'b.txt',
      type: 'text',
      content: 'middle',
    });
    const mockOpen = vi.fn();
    useAppStore.setState({
      attachmentModal: { open: true, spaceId: 'space-1', taskId: 'task-1', index: 1, name: 'b.txt', attachments: THREE_ATTACHMENTS },
      openAttachmentModal: mockOpen,
    } as any);

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('middle'));
    fireEvent.click(screen.getByRole('button', { name: /previous attachment/i }));

    expect(mockOpen).toHaveBeenCalledWith('space-1', 'task-1', 0, 'a.txt', THREE_ATTACHMENTS);
  });

  it('shows "2 / 3" indicator when on middle attachment', async () => {
    mockGetAttachmentContent.mockResolvedValue({
      name: 'b.txt',
      type: 'text',
      content: 'middle',
    });
    useAppStore.setState({
      attachmentModal: { open: true, spaceId: 'space-1', taskId: 'task-1', index: 1, name: 'b.txt', attachments: THREE_ATTACHMENTS },
    });

    render(<AttachmentModal />);

    await waitFor(() => screen.getByText('middle'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
});
