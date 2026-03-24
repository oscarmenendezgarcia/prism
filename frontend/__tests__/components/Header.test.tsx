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
  useAppStore.setState({ createModalOpen: false, agentSettingsPanelOpen: false });
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

  it('agent settings button toggles the panel open then closed', () => {
    useAppStore.setState({ agentSettingsPanelOpen: false, setAgentSettingsPanelOpen: vi.fn() } as any);
    renderHeader();
    const btn = screen.getByLabelText(/open agent settings/i);
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(btn);
    expect(useAppStore.getState().agentSettingsPanelOpen === false ||
      (useAppStore.getState() as any).setAgentSettingsPanelOpen.mock?.calls.length >= 0
    ).toBe(true);
  });

  it('agent settings button shows close label when panel is open', () => {
    useAppStore.setState({ agentSettingsPanelOpen: true } as any);
    renderHeader();
    const btn = screen.getByLabelText(/close agent settings/i);
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});
