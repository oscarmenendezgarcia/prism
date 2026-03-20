/**
 * Component tests for AgentLauncherMenu.
 * T-023: trigger button, dropdown, agent selection, disabled state, outside click,
 *        empty state, Run Full Pipeline option.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentLauncherMenu } from '../../src/components/agent-launcher/AgentLauncherMenu';
import { useAppStore } from '../../src/stores/useAppStore';
import type { AgentInfo } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock the API client so no real HTTP calls are made.
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:       vi.fn(),
  getTasks:        vi.fn(),
  createTask:      vi.fn(),
  moveTask:        vi.fn(),
  deleteTask:      vi.fn(),
  createSpace:     vi.fn(),
  renameSpace:     vi.fn(),
  deleteSpace:     vi.fn(),
  getAttachmentContent: vi.fn(),
  getAgents:       vi.fn(),
  getAgent:        vi.fn(),
  generatePrompt:  vi.fn(),
  getSettings:     vi.fn(),
  saveSettings:    vi.fn(),
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
  {
    id:          'developer-agent',
    name:        'developer-agent.md',
    displayName: 'Developer Agent',
    path:        '/home/user/.claude/agents/developer-agent.md',
    sizeBytes:   6300,
  },
];

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    availableAgents:  [],
    activeRun:        null,
    pipelineState:    null,
    preparedRun:      null,
    promptPreviewOpen: false,
    terminalSender:   null,
    loadAgents:       vi.fn(),
    prepareAgentRun:  vi.fn(),
    startPipeline:    vi.fn(),
    ...overrides,
  } as any);
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMenu(props: { taskId?: string; spaceId?: string } = {}) {
  return render(
    <AgentLauncherMenu taskId={props.taskId ?? 'task-1'} spaceId={props.spaceId ?? 'space-1'} />
  );
}

function getTrigger() {
  return screen.getByRole('button', { name: /run agent/i });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentLauncherMenu — trigger button', () => {
  it('renders the Run Agent trigger button', () => {
    renderMenu();
    expect(getTrigger()).toBeInTheDocument();
  });

  it('trigger button has aria-haspopup="true"', () => {
    renderMenu();
    expect(getTrigger()).toHaveAttribute('aria-haspopup', 'true');
  });

  it('trigger button is not disabled when activeRun is null', () => {
    renderMenu();
    expect(getTrigger()).not.toBeDisabled();
  });

  it('trigger button is disabled when activeRun is non-null', () => {
    useAppStore.setState({
      activeRun: {
        taskId:     'task-1',
        agentId:    'senior-architect',
        spaceId:    'space-1',
        startedAt:  new Date().toISOString(),
        cliCommand: 'claude -p "..."',
        promptPath: '/tmp/prompt.md',
      },
    } as any);
    renderMenu();
    expect(getTrigger()).toBeDisabled();
  });

  it('disabled trigger shows "Agent already running" title', () => {
    useAppStore.setState({
      activeRun: {
        taskId:     'task-1',
        agentId:    'senior-architect',
        spaceId:    'space-1',
        startedAt:  new Date().toISOString(),
        cliCommand: 'claude -p "..."',
        promptPath: '/tmp/prompt.md',
      },
    } as any);
    renderMenu();
    expect(getTrigger()).toHaveAttribute('title', 'Agent already running');
  });

  it('enabled trigger shows "Run agent" title', () => {
    renderMenu();
    expect(getTrigger()).toHaveAttribute('title', 'Run agent');
  });
});

describe('AgentLauncherMenu — dropdown open/close', () => {
  it('dropdown is not visible initially', () => {
    renderMenu();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking trigger opens the dropdown', () => {
    renderMenu();
    fireEvent.click(getTrigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('trigger shows aria-expanded=true when open', () => {
    renderMenu();
    fireEvent.click(getTrigger());
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('pressing Escape closes the dropdown', () => {
    renderMenu();
    fireEvent.click(getTrigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking outside the dropdown closes it', () => {
    renderMenu();
    fireEvent.click(getTrigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Simulate a click outside by firing mousedown on document.body.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking disabled trigger does not open the dropdown', () => {
    useAppStore.setState({
      activeRun: {
        taskId:    'task-1',
        agentId:   'senior-architect',
        spaceId:   'space-1',
        startedAt: new Date().toISOString(),
        cliCommand: '',
        promptPath: '',
      },
    } as any);
    renderMenu();
    // The button is disabled, so click should be ignored by the browser.
    // We verify the menu never appears.
    fireEvent.click(getTrigger());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('AgentLauncherMenu — agent list', () => {
  it('shows empty state when availableAgents is empty', () => {
    useAppStore.setState({ availableAgents: [] } as any);
    renderMenu();
    fireEvent.click(getTrigger());
    expect(screen.getByText(/no agents found/i)).toBeInTheDocument();
  });

  it('shows all agent displayNames when agents are loaded', () => {
    useAppStore.setState({ availableAgents: SAMPLE_AGENTS } as any);
    renderMenu();
    fireEvent.click(getTrigger());
    expect(screen.getByText('Senior Architect')).toBeInTheDocument();
    expect(screen.getByText('Developer Agent')).toBeInTheDocument();
  });

  it('calls loadAgents on first open when availableAgents is empty', async () => {
    const mockLoadAgents = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ availableAgents: [], loadAgents: mockLoadAgents } as any);

    renderMenu();
    fireEvent.click(getTrigger());

    await waitFor(() => {
      expect(mockLoadAgents).toHaveBeenCalledOnce();
    });
  });

  it('does NOT call loadAgents when agents are already loaded', async () => {
    const mockLoadAgents = vi.fn();
    useAppStore.setState({ availableAgents: SAMPLE_AGENTS, loadAgents: mockLoadAgents } as any);

    renderMenu();
    fireEvent.click(getTrigger());

    // Give a tick for any async effects.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockLoadAgents).not.toHaveBeenCalled();
  });

  it('each agent renders a menuitem role', () => {
    useAppStore.setState({ availableAgents: SAMPLE_AGENTS } as any);
    renderMenu();
    fireEvent.click(getTrigger());
    const items = screen.getAllByRole('menuitem');
    // 2 agents + 1 "Run Full Pipeline" = 3 menuitems
    expect(items.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AgentLauncherMenu — agent selection', () => {
  it('clicking an agent calls prepareAgentRun with correct taskId and agentId', async () => {
    const mockPrepare = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ availableAgents: SAMPLE_AGENTS, prepareAgentRun: mockPrepare } as any);

    renderMenu({ taskId: 'task-abc' });
    fireEvent.click(getTrigger());

    fireEvent.click(screen.getByText('Senior Architect'));

    expect(mockPrepare).toHaveBeenCalledWith('task-abc', 'senior-architect');
  });

  it('dropdown closes after selecting an agent', async () => {
    const mockPrepare = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ availableAgents: SAMPLE_AGENTS, prepareAgentRun: mockPrepare } as any);

    renderMenu();
    fireEvent.click(getTrigger());
    fireEvent.click(screen.getByText('Developer Agent'));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('AgentLauncherMenu — Run Full Pipeline', () => {
  it('shows "Run Full Pipeline" option in the dropdown', () => {
    renderMenu();
    fireEvent.click(getTrigger());
    expect(screen.getByText(/run full pipeline/i)).toBeInTheDocument();
  });

  it('clicking Run Full Pipeline calls startPipeline with the spaceId', () => {
    const mockStartPipeline = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ startPipeline: mockStartPipeline } as any);

    renderMenu({ spaceId: 'my-space-id' });
    fireEvent.click(getTrigger());
    fireEvent.click(screen.getByText(/run full pipeline/i));

    expect(mockStartPipeline).toHaveBeenCalledWith('my-space-id', 'task-1');
  });

  it('dropdown closes after clicking Run Full Pipeline', () => {
    const mockStartPipeline = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ startPipeline: mockStartPipeline } as any);

    renderMenu();
    fireEvent.click(getTrigger());
    fireEvent.click(screen.getByText(/run full pipeline/i));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
