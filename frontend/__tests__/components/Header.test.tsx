import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../src/components/layout/Header';
import { useAppStore } from '../../src/stores/useAppStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

// ADR-003: Header now renders ThemeToggle which calls window.matchMedia via useTheme.
function setupMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  setupMatchMedia();
  useAppStore.setState({ createModalOpen: false, agentSettingsPanelOpen: false, isGlobalSearchOpen: false });
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

  it('renders ThemeToggle button (ADR-003)', () => {
    renderHeader();
    // ThemeToggle renders a button with an aria-label about theme switching
    expect(screen.getByLabelText(/switch to/i)).toBeInTheDocument();
  });

  it('agent settings button has static aria-label and aria-pressed=false when closed', () => {
    useAppStore.setState({ agentSettingsPanelOpen: false, setAgentSettingsPanelOpen: vi.fn() } as any);
    renderHeader();
    const btn = screen.getByLabelText(/agent settings/i);
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('agent settings button has static aria-label and aria-pressed=true when open', () => {
    useAppStore.setState({ agentSettingsPanelOpen: true } as any);
    renderHeader();
    const btn = screen.getByLabelText(/agent settings/i);
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('Terminal toggle appears before AgentSettings toggle in DOM order (T-4 redesign)', () => {
    renderHeader();
    const buttons = screen.getAllByRole('button');
    const terminalIdx = buttons.findIndex((b) => /toggle terminal panel/i.test(b.getAttribute('aria-label') ?? ''));
    const agentIdx    = buttons.findIndex((b) => /agent settings/i.test(b.getAttribute('aria-label') ?? ''));
    expect(terminalIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(terminalIdx).toBeLessThan(agentIdx);
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
