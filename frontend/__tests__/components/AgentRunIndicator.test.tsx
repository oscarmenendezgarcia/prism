/**
 * Component tests for AgentRunIndicator.
 * BUG-002: zero coverage — these tests cover all required behaviors:
 *   - null render when activeRun is null
 *   - displays agent displayName and elapsed time
 *   - Cancel button calls cancelAgentRun
 *   - elapsed timer ticks every second
 *   - aria-live region present
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AgentRunIndicator } from '../../src/components/agent-launcher/AgentRunIndicator';
import { useAppStore } from '../../src/stores/useAppStore';
import type { AgentInfo, AgentRun } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock the API client — AgentRunIndicator reads from store only, but the
// store imports api/client at module load time.
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:          vi.fn(),
  getTasks:           vi.fn(),
  createTask:         vi.fn(),
  moveTask:           vi.fn(),
  deleteTask:         vi.fn(),
  createSpace:        vi.fn(),
  renameSpace:        vi.fn(),
  deleteSpace:        vi.fn(),
  getAttachmentContent: vi.fn(),
  getAgents:          vi.fn(),
  generatePrompt:     vi.fn(),
  getSettings:        vi.fn(),
  saveSettings:       vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_AGENTS: AgentInfo[] = [
  {
    id:          'senior-architect',
    name:        'senior-architect.md',
    displayName: 'Senior Architect',
    path:        '/home/user/.claude/agents/senior-architect.md',
    sizeBytes:   11400,
  },
];

function makeActiveRun(agentId = 'senior-architect', startedAt?: string): AgentRun {
  return {
    taskId:     'task-abc',
    agentId,
    spaceId:    'space-1',
    startedAt:  startedAt ?? new Date().toISOString(),
    cliCommand: 'claude -p "$(cat /tmp/prompt.md)"',
    promptPath: '/tmp/prompt.md',
  };
}

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    availableAgents:  [],
    activeRun:        null,
    cancelAgentRun:   vi.fn(),
    ...overrides,
  } as any);
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentRunIndicator — null render', () => {
  it('renders nothing when activeRun is null', () => {
    resetStore({ activeRun: null });
    const { container } = render(<AgentRunIndicator />);
    expect(container.firstChild).toBeNull();
  });
});

describe('AgentRunIndicator — active run rendering', () => {
  it('renders the indicator when activeRun is set', () => {
    resetStore({ activeRun: makeActiveRun(), availableAgents: SAMPLE_AGENTS });
    render(<AgentRunIndicator />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the agent displayName when found in availableAgents', () => {
    resetStore({ activeRun: makeActiveRun('senior-architect'), availableAgents: SAMPLE_AGENTS });
    render(<AgentRunIndicator />);
    expect(screen.getByText('Senior Architect')).toBeInTheDocument();
  });

  it('falls back to agentId when agent not in availableAgents', () => {
    resetStore({ activeRun: makeActiveRun('unknown-agent'), availableAgents: [] });
    render(<AgentRunIndicator />);
    expect(screen.getByText('unknown-agent')).toBeInTheDocument();
  });

  it('displays elapsed time as m:ss format', () => {
    // Start 65 seconds in the past
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    resetStore({ activeRun: makeActiveRun('senior-architect', startedAt), availableAgents: SAMPLE_AGENTS });
    render(<AgentRunIndicator />);
    expect(screen.getByText('1:05')).toBeInTheDocument();
  });

  it('shows 0:00 for a brand-new run', () => {
    resetStore({ activeRun: makeActiveRun(), availableAgents: SAMPLE_AGENTS });
    render(<AgentRunIndicator />);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('has role="status" and aria-live="polite" for accessibility', () => {
    resetStore({ activeRun: makeActiveRun(), availableAgents: SAMPLE_AGENTS });
    render(<AgentRunIndicator />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('aria-label contains agent name and elapsed time', () => {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    resetStore({ activeRun: makeActiveRun('senior-architect', startedAt), availableAgents: SAMPLE_AGENTS });
    render(<AgentRunIndicator />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-label', expect.stringContaining('Senior Architect'));
    expect(el).toHaveAttribute('aria-label', expect.stringContaining('0:05'));
  });
});

describe('AgentRunIndicator — Cancel button', () => {
  it('renders a Cancel button', () => {
    resetStore({ activeRun: makeActiveRun(), availableAgents: SAMPLE_AGENTS });
    render(<AgentRunIndicator />);
    expect(screen.getByRole('button', { name: /cancel agent run/i })).toBeInTheDocument();
  });

  it('clicking Cancel calls cancelAgentRun from store', () => {
    const cancelFn = vi.fn();
    resetStore({
      activeRun:      makeActiveRun(),
      availableAgents: SAMPLE_AGENTS,
      cancelAgentRun: cancelFn,
    });
    render(<AgentRunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /cancel agent run/i }));
    expect(cancelFn).toHaveBeenCalledOnce();
  });
});

describe('AgentRunIndicator — elapsed timer', () => {
  it('increments elapsed time every second', () => {
    resetStore({ activeRun: makeActiveRun(), availableAgents: SAMPLE_AGENTS });
    render(<AgentRunIndicator />);

    // Initially 0:00
    expect(screen.getByText('0:00')).toBeInTheDocument();

    // Advance 3 seconds
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('0:03')).toBeInTheDocument();
  });

  it('resets elapsed time when activeRun changes to a new run', () => {
    const firstRun = makeActiveRun('senior-architect', new Date(Date.now() - 30_000).toISOString());
    resetStore({ activeRun: firstRun, availableAgents: SAMPLE_AGENTS });
    const { rerender } = render(<AgentRunIndicator />);
    expect(screen.getByText('0:30')).toBeInTheDocument();

    // New run starting now
    const newRun = makeActiveRun('senior-architect', new Date().toISOString());
    useAppStore.setState({ activeRun: newRun } as any);
    rerender(<AgentRunIndicator />);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('clears interval when component unmounts', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    resetStore({ activeRun: makeActiveRun(), availableAgents: SAMPLE_AGENTS });
    const { unmount } = render(<AgentRunIndicator />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
