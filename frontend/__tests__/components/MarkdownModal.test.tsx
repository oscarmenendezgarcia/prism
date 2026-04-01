import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MarkdownModal } from '../../src/components/modals/MarkdownModal';
import { useAppStore } from '../../src/stores/useAppStore';

// ---------------------------------------------------------------------------
// Clipboard stub (jsdom does not implement it)
// ---------------------------------------------------------------------------

beforeEach(() => {
  useAppStore.setState({ markdownModal: null });
  vi.clearAllMocks();

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// Base state
// ---------------------------------------------------------------------------

const BASE_MODAL = {
  open: true,
  title: 'ADR-1.md',
  content: '# Hello\n\nWorld paragraph.',
};

// ---------------------------------------------------------------------------
// Closed state
// ---------------------------------------------------------------------------

describe('MarkdownModal — closed state', () => {
  it('renders nothing when markdownModal is null', () => {
    render(<MarkdownModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing when open is false', () => {
    useAppStore.setState({ markdownModal: { ...BASE_MODAL, open: false } });
    render(<MarkdownModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Open state — structure
// ---------------------------------------------------------------------------

describe('MarkdownModal — open state', () => {
  it('renders a dialog when open is true', () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the attachment title in the header', () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);
    expect(screen.getByText('ADR-1.md')).toBeInTheDocument();
  });

  it('renders the markdown content — heading is visible', () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);
    expect(screen.getByRole('heading', { level: 1, name: 'Hello' })).toBeInTheDocument();
  });

  it('renders the markdown content — paragraph is visible', () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);
    expect(screen.getByText('World paragraph.')).toBeInTheDocument();
  });

  it('renders Close and "Copy raw" buttons', () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);
    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(screen.getByText('Copy raw')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Source banner
// ---------------------------------------------------------------------------

describe('MarkdownModal — source banner', () => {
  it('does not render source banner when source is absent', () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);
    expect(screen.queryByText('Source File Path')).not.toBeInTheDocument();
  });

  it('renders source banner when source is provided', () => {
    useAppStore.setState({
      markdownModal: { ...BASE_MODAL, source: '/home/user/docs/ADR-1.md' },
    });
    render(<MarkdownModal />);
    expect(screen.getByText('Source File Path')).toBeInTheDocument();
    expect(screen.getByText('/home/user/docs/ADR-1.md')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Copy raw button
// ---------------------------------------------------------------------------

describe('MarkdownModal — Copy raw button', () => {
  it('copies markdown content to clipboard', async () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);

    fireEvent.click(screen.getByText('Copy raw'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(BASE_MODAL.content);
  });

  it('shows "Copied!" label after click', async () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);

    fireEvent.click(screen.getByText('Copy raw'));

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('does not throw when modal is null during copy', () => {
    // modal starts as null — the button should not be rendered
    render(<MarkdownModal />);
    expect(screen.queryByText('Copy raw')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Close interactions
// ---------------------------------------------------------------------------

describe('MarkdownModal — close interactions', () => {
  it('Close button calls closeMarkdownModal', () => {
    const mockClose = vi.fn();
    useAppStore.setState({
      markdownModal: BASE_MODAL,
      closeMarkdownModal: mockClose,
    } as any);

    render(<MarkdownModal />);
    fireEvent.click(screen.getByText('Close'));

    expect(mockClose).toHaveBeenCalled();
  });

  it('× button in header calls closeMarkdownModal', () => {
    vi.useFakeTimers();
    const mockClose = vi.fn();
    useAppStore.setState({
      markdownModal: BASE_MODAL,
      closeMarkdownModal: mockClose,
    } as any);

    render(<MarkdownModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    // M-1: 180ms exit animation plays before onClose fires
    act(() => { vi.advanceTimersByTime(200); });

    expect(mockClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('Escape key closes the modal', () => {
    vi.useFakeTimers();
    const mockClose = vi.fn();
    useAppStore.setState({
      markdownModal: BASE_MODAL,
      closeMarkdownModal: mockClose,
    } as any);

    render(<MarkdownModal />);
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(200); });

    expect(mockClose).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// GFM rendering inside the modal
// ---------------------------------------------------------------------------

describe('MarkdownModal — GFM rendering', () => {
  it('renders a GFM table inside the modal', () => {
    const tableContent = '| A | B |\n|---|---|\n| 1 | 2 |';
    useAppStore.setState({ markdownModal: { ...BASE_MODAL, content: tableContent } });
    render(<MarkdownModal />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders GFM task-list checkboxes', () => {
    const taskContent = '- [x] Done\n- [ ] Pending';
    useAppStore.setState({ markdownModal: { ...BASE_MODAL, content: taskContent } });
    render(<MarkdownModal />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('renders inline code', () => {
    useAppStore.setState({ markdownModal: { ...BASE_MODAL, content: 'Use `npm test`' } });
    render(<MarkdownModal />);
    expect(screen.getByText('npm test')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('MarkdownModal — accessibility', () => {
  it('dialog has aria-labelledby pointing to the title id', () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toBeInTheDocument();
  });

  it('dialog is aria-modal', () => {
    useAppStore.setState({ markdownModal: BASE_MODAL });
    render(<MarkdownModal />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
