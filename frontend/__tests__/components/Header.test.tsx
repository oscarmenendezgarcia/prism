import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../src/components/layout/Header';
import { useAppStore } from '../../src/stores/useAppStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ createModalOpen: false, isGlobalSearchOpen: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderHeader() {
  return render(<Header />);
}

describe('Header', () => {
  it('renders Prism title', () => {
    renderHeader();
    expect(screen.getByText('Prism')).toBeInTheDocument();
  });

  it('renders New Task button', () => {
    renderHeader();
    expect(screen.getByText('New Task')).toBeInTheDocument();
  });

  it('renders Terminal toggle button', () => {
    renderHeader();
    // Terminal toggle is icon-only; check for the aria-label instead.
    expect(screen.getByRole('button', { name: /toggle terminal panel/i })).toBeInTheDocument();
  });

  it('opens create modal when New Task button clicked', () => {
    const mockOpen = vi.fn();
    useAppStore.setState({ openCreateModal: mockOpen } as any);
    renderHeader();
    fireEvent.click(screen.getByText('New Task'));
    expect(mockOpen).toHaveBeenCalled();
  });

  it('does not render a standalone theme toggle or Agent Settings button (moved into Config → Preferences)', () => {
    renderHeader();
    expect(screen.queryByLabelText(/switch to/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/agent settings/i)).not.toBeInTheDocument();
  });

  describe('Search pill (QOL-4)', () => {
    it('renders search pill with aria-label', () => {
      renderHeader();
      // There are two buttons with this label (desktop pill + mobile icon button — both in DOM)
      const pills = screen.getAllByLabelText(/search tasks/i);
      expect(pills.length).toBeGreaterThanOrEqual(1);
    });

    it('search pill displays a platform-appropriate shortcut hint (⌘K or Ctrl K)', () => {
      renderHeader();
      // The kbd label is platform-aware: ⌘K on macOS, "Ctrl K" elsewhere (jsdom → Ctrl K).
      expect(screen.getByText(/⌘K|Ctrl\s*K/i)).toBeInTheDocument();
    });

    it('clicking the desktop search pill calls openGlobalSearch', () => {
      const mockOpenGlobalSearch = vi.fn();
      useAppStore.setState({ openGlobalSearch: mockOpenGlobalSearch } as any);
      renderHeader();
      // The desktop pill is the entry point carrying the "Search…" label text.
      const desktopPill = screen.getAllByLabelText(/search tasks/i)
        .find((b) => b.textContent?.includes('Search…'))!;
      fireEvent.click(desktopPill);
      expect(mockOpenGlobalSearch).toHaveBeenCalledTimes(1);
    });

    it('clicking the mobile search icon button calls openGlobalSearch', () => {
      const mockOpenGlobalSearch = vi.fn();
      useAppStore.setState({ openGlobalSearch: mockOpenGlobalSearch } as any);
      renderHeader();
      // Mobile entry point is the compact icon-only button (md:hidden) on the left —
      // same aria-label but no "Search…" text. No hamburger needed.
      const mobileIcon = screen.getAllByLabelText(/search tasks/i)
        .find((b) => !b.textContent?.includes('Search…'))!;
      fireEvent.click(mobileIcon);
      expect(mockOpenGlobalSearch).toHaveBeenCalledTimes(1);
    });

    it('renders both desktop pill and mobile icon search entry points', () => {
      renderHeader();
      // Two always-rendered entry points (CSS toggles visibility): desktop pill + mobile icon.
      const pills = screen.getAllByLabelText(/search tasks/i);
      expect(pills.length).toBe(2);
    });

    it('search pill is keyboard-accessible (has accessible role button)', () => {
      renderHeader();
      const pills = screen.getAllByRole('button', { name: /search tasks/i });
      expect(pills.length).toBeGreaterThanOrEqual(1);
    });
  });
});
