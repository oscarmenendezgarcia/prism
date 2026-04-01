/**
 * Unit tests for useAppStore Zustand store.
 * All API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock useTerminalSessionStore ─────────────────────────────────────────────
// executeAgentRun, cancelAgentRun, abortPipeline now call activeSendInput() on
// this store instead of reading terminalSender from useAppStore (ADR-1 multi-tab).

let mockActiveSendInput: ReturnType<typeof vi.fn> = vi.fn(() => null);

vi.mock('../../src/stores/useTerminalSessionStore', () => {
  const store = {
    getState: () => ({
      activeSendInput: mockActiveSendInput,
      sessions: [],
      activeId: null,
      panelOpen: false,
      openPanel: vi.fn(),
      closePanel: vi.fn(),
      togglePanel: vi.fn(),
      addSession: vi.fn(),
      removeSession: vi.fn(),
      setActiveId: vi.fn(),
      renameSession: vi.fn(),
      updateStatus: vi.fn(),
      registerSender: vi.fn(),
    }),
  };
  return {
    useTerminalSessionStore: Object.assign(vi.fn((selector: (s: unknown) => unknown) => {
      return selector ? selector(store.getState()) : store.getState();
    }), store),
    MAX_SESSIONS: 4,
  };
});

// ── Mock the API client before importing the store ───────────────────────────
vi.mock('../../src/api/client', () => ({
  getSpaces:            vi.fn(),
  createSpace:          vi.fn(),
  renameSpace:          vi.fn(),
  deleteSpace:          vi.fn(),
  getTasks:             vi.fn(),
  createTask:           vi.fn(),
  moveTask:             vi.fn(),
  deleteTask:           vi.fn(),
  getAttachmentContent: vi.fn(),
  // Agent launcher API
  getAgents:            vi.fn(),
  generatePrompt:       vi.fn(),
  getSettings:          vi.fn(),
  saveSettings:         vi.fn(),
  // Agent run history API
  createAgentRun:       vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun:       vi.fn().mockResolvedValue({ id: 'run_mock', status: 'completed' }),
  getAgentRuns:         vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  // Backend pipeline run API (T-4)
  startRun:             vi.fn().mockResolvedValue({ runId: 'run-orch-1', status: 'pending', stages: ['orchestrator'], spaceId: 'space-1', taskId: 'task-1', createdAt: new Date().toISOString() }),
  getBackendRun:        vi.fn().mockResolvedValue({ runId: 'run-orch-1', status: 'completed', stages: ['orchestrator'], spaceId: 'space-1', taskId: 'task-1', createdAt: new Date().toISOString() }),
  deleteRun:            vi.fn().mockResolvedValue(undefined),
}));

import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';

// Wipe store between tests
function resetStore() {
  useAppStore.setState({
    spaces: [],
    activeSpaceId: 'default',
    tasks: { todo: [], 'in-progress': [], done: [] },
    isMutating: false,
    createModalOpen: false,
    attachmentModal: null,
    spaceModal: null,
    deleteSpaceDialog: null,
    toast: null,
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  // Clear localStorage
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('setActiveSpace', () => {
  it('updates activeSpaceId and persists to localStorage', () => {
    useAppStore.getState().setActiveSpace('space-123');
    expect(useAppStore.getState().activeSpaceId).toBe('space-123');
    expect(localStorage.getItem('prism-active-space')).toBe('space-123');
  });
});

describe('loadSpaces', () => {
  it('fetches spaces, updates state, and calls loadBoard', async () => {
    const mockSpaces = [
      { id: 'default', name: 'General', createdAt: '', updatedAt: '' },
    ];
    vi.mocked(api.getSpaces).mockResolvedValue(mockSpaces);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().loadSpaces();

    expect(useAppStore.getState().spaces).toEqual(mockSpaces);
    expect(api.getTasks).toHaveBeenCalledWith('default');
  });

  it('falls back to first space when active space no longer exists', async () => {
    const mockSpaces = [
      { id: 'other-space', name: 'Other', createdAt: '', updatedAt: '' },
    ];
    useAppStore.setState({ activeSpaceId: 'deleted-space' });
    vi.mocked(api.getSpaces).mockResolvedValue(mockSpaces);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().loadSpaces();

    expect(useAppStore.getState().activeSpaceId).toBe('other-space');
  });

  it('shows error toast on failure', async () => {
    vi.mocked(api.getSpaces).mockRejectedValue(new Error('Network error'));
    await useAppStore.getState().loadSpaces();
    const toast = useAppStore.getState().toast;
    expect(toast).not.toBeNull();
    expect(toast?.type).toBe('error');
  });
});

describe('loadBoard', () => {
  it('fetches tasks for active space and updates store', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    const board = {
      todo: [{ id: 't1', title: 'Task 1', type: 'chore' as const, createdAt: '', updatedAt: '' }],
      'in-progress': [],
      done: [],
    };
    vi.mocked(api.getTasks).mockResolvedValue(board);

    await useAppStore.getState().loadBoard();

    expect(useAppStore.getState().tasks).toEqual(board);
    expect(api.getTasks).toHaveBeenCalledWith('space-1');
  });

  it('shows error toast on failure', async () => {
    vi.mocked(api.getTasks).mockRejectedValue(new Error('API down'));
    await useAppStore.getState().loadBoard();
    expect(useAppStore.getState().toast?.type).toBe('error');
  });
});

describe('createTask', () => {
  it('calls api.createTask, closes modal, reloads board, shows toast', async () => {
    useAppStore.setState({ createModalOpen: true });
    vi.mocked(api.createTask).mockResolvedValue({ id: 'new', title: 'New task', type: 'chore', createdAt: '', updatedAt: '' });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().createTask({ title: 'New task', type: 'chore' });

    expect(useAppStore.getState().createModalOpen).toBe(false);
    expect(api.createTask).toHaveBeenCalled();
    expect(api.getTasks).toHaveBeenCalled();
    expect(useAppStore.getState().toast?.type).toBe('success');
  });

  it('sets isMutating true during call and false after', async () => {
    vi.mocked(api.createTask).mockResolvedValue({ id: 'x', title: 'T', type: 'chore', createdAt: '', updatedAt: '' });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    const promise = useAppStore.getState().createTask({ title: 'T', type: 'chore' });
    // isMutating should be true synchronously right after start
    // Note: because Zustand sets synchronously before await, we can check after resolution
    await promise;
    expect(useAppStore.getState().isMutating).toBe(false);
  });

  it('re-throws error and resets isMutating on failure', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Validation error'));
    await expect(
      useAppStore.getState().createTask({ title: 'T', type: 'chore' })
    ).rejects.toThrow('Validation error');
    expect(useAppStore.getState().isMutating).toBe(false);
  });
});

describe('moveTask', () => {
  it('calls api.moveTask with target column, shows toast, reloads board', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    vi.mocked(api.moveTask).mockResolvedValue({
      task: { id: 't1', title: 'T', type: 'chore', createdAt: '', updatedAt: '' },
      from: 'todo',
      to: 'in-progress',
    });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().moveTask('t1', 'right', 'todo');

    expect(api.moveTask).toHaveBeenCalledWith('space-1', 't1', 'in-progress');
    expect(useAppStore.getState().toast?.message).toContain('In Progress');
    expect(api.getTasks).toHaveBeenCalled();
  });

  it('moves left from in-progress to todo', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    vi.mocked(api.moveTask).mockResolvedValue({
      task: { id: 't1', title: 'T', type: 'chore', createdAt: '', updatedAt: '' },
      from: 'in-progress',
      to: 'todo',
    });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().moveTask('t1', 'left', 'in-progress');

    expect(api.moveTask).toHaveBeenCalledWith('space-1', 't1', 'todo');
  });
});

describe('deleteTask', () => {
  it('calls api.deleteTask, shows toast, reloads board', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    vi.mocked(api.deleteTask).mockResolvedValue({ deleted: true, id: 't1' });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().deleteTask('t1');

    expect(api.deleteTask).toHaveBeenCalledWith('space-1', 't1');
    expect(useAppStore.getState().toast?.message).toBe('Task deleted');
  });
});

describe('modal open/close actions', () => {
  it('openCreateModal / closeCreateModal', () => {
    useAppStore.getState().openCreateModal();
    expect(useAppStore.getState().createModalOpen).toBe(true);
    useAppStore.getState().closeCreateModal();
    expect(useAppStore.getState().createModalOpen).toBe(false);
  });

  it('openAttachmentModal / closeAttachmentModal', () => {
    useAppStore.getState().openAttachmentModal('s1', 't1', 0, 'file.txt');
    const modal = useAppStore.getState().attachmentModal;
    expect(modal).toMatchObject({ open: true, spaceId: 's1', taskId: 't1', index: 0, name: 'file.txt' });
    useAppStore.getState().closeAttachmentModal();
    expect(useAppStore.getState().attachmentModal).toBeNull();
  });

  it('openSpaceModal create mode', () => {
    useAppStore.getState().openSpaceModal('create');
    const modal = useAppStore.getState().spaceModal;
    expect(modal).toMatchObject({ open: true, mode: 'create' });
  });

  it('openSpaceModal rename mode with space', () => {
    const space = { id: 's1', name: 'Test', createdAt: '', updatedAt: '' };
    useAppStore.getState().openSpaceModal('rename', space);
    const modal = useAppStore.getState().spaceModal;
    expect(modal).toMatchObject({ open: true, mode: 'rename', space });
  });

  it('closeSpaceModal', () => {
    useAppStore.getState().openSpaceModal('create');
    useAppStore.getState().closeSpaceModal();
    expect(useAppStore.getState().spaceModal).toBeNull();
  });

  it('openDeleteSpaceDialog / closeDeleteSpaceDialog', () => {
    useAppStore.getState().openDeleteSpaceDialog('s1');
    expect(useAppStore.getState().deleteSpaceDialog).toMatchObject({ open: true, spaceId: 's1' });
    useAppStore.getState().closeDeleteSpaceDialog();
    expect(useAppStore.getState().deleteSpaceDialog).toBeNull();
  });
});

describe('showToast', () => {
  it('sets toast state with message and success type', () => {
    vi.useFakeTimers();
    useAppStore.getState().showToast('Task created');
    expect(useAppStore.getState().toast).toEqual({ message: 'Task created', type: 'success' });
    vi.useRealTimers();
  });

  it('sets error type', () => {
    vi.useFakeTimers();
    useAppStore.getState().showToast('Something broke', 'error');
    expect(useAppStore.getState().toast?.type).toBe('error');
    vi.useRealTimers();
  });

  it('auto-clears after 3 seconds', () => {
    vi.useFakeTimers();
    useAppStore.getState().showToast('Fading');
    vi.advanceTimersByTime(3001);
    expect(useAppStore.getState().toast).toBeNull();
    vi.useRealTimers();
  });
});

// toggleTerminal has been removed from useAppStore — it now lives in
// useTerminalSessionStore (ADR-1: multi-tab-terminal). Tests for
// togglePanel are in useTerminalSessionStore.test.ts.

// ==========================================================================
// BUG-003: Launcher store slice tests
// ==========================================================================

// ---------------------------------------------------------------------------
// Fixtures shared across launcher slice suites
// ---------------------------------------------------------------------------

const MOCK_PROMPT_RESULT = {
  promptPath:      '/tmp/.prompts/prompt-123.md',
  promptPreview:   '## TASK CONTEXT\nTitle: Test Task',
  cliCommand:      'claude -p "$(cat \'/tmp/.prompts/prompt-123.md\')"',
  estimatedTokens: 256,
};

const MOCK_SETTINGS = {
  cli: {
    tool:            'claude',
    binary:          'claude',
    flags:           ['-p'],
    promptFlag:      '-p',
    fileInputMethod: 'cat-subshell',
  },
  pipeline: {
    autoAdvance:          true,
    confirmBetweenStages: true,
    stages: ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'],
  },
  prompts: {
    includeKanbanBlock: true,
    includeGitBlock:    true,
    workingDirectory:   '',
  },
};

function resetLauncherStore() {
  // Reset the activeSendInput mock to return null by default (no terminal connected).
  mockActiveSendInput = vi.fn(() => null);
  useAppStore.setState({
    spaces:           [],
    activeSpaceId:    'space-1',
    tasks:            { todo: [], 'in-progress': [], done: [] },
    isMutating:       false,
    createModalOpen:  false,
    attachmentModal:  null,
    spaceModal:       null,
    deleteSpaceDialog: null,
    toast:            null,
    availableAgents:  [],
    activeRun:        null,
    _agentRunPollId:  null,
    preparedRun:      null,
    promptPreviewOpen: false,
    pipelineState:    null,
    agentSettings:    null,
    settingsLoading:  false,
    agentSettingsPanelOpen: false,
  });
}

// ---------------------------------------------------------------------------
// prepareAgentRun
// ---------------------------------------------------------------------------

describe('prepareAgentRun', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
  });

  it('calls api.generatePrompt with agentId, taskId, spaceId', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    await useAppStore.getState().prepareAgentRun('task-1', 'senior-architect');

    expect(api.generatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'senior-architect',
        taskId:  'task-1',
        spaceId: 'space-1',
      })
    );
  });

  it('sets preparedRun in state with all fields', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    await useAppStore.getState().prepareAgentRun('task-1', 'developer-agent');

    const { preparedRun } = useAppStore.getState();
    expect(preparedRun).not.toBeNull();
    expect(preparedRun?.agentId).toBe('developer-agent');
    expect(preparedRun?.taskId).toBe('task-1');
    expect(preparedRun?.promptPath).toBe(MOCK_PROMPT_RESULT.promptPath);
    expect(preparedRun?.cliCommand).toBe(MOCK_PROMPT_RESULT.cliCommand);
  });

  it('sets promptPreviewOpen to true on success', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    await useAppStore.getState().prepareAgentRun('task-1', 'developer-agent');

    expect(useAppStore.getState().promptPreviewOpen).toBe(true);
  });

  it('shows error toast on failure', async () => {
    vi.mocked(api.generatePrompt).mockRejectedValue(new Error('TASK_NOT_FOUND'));

    await useAppStore.getState().prepareAgentRun('bad-task', 'developer-agent');

    const { toast, preparedRun } = useAppStore.getState();
    expect(toast?.type).toBe('error');
    expect(toast?.message).toContain('Failed to prepare agent run');
    expect(preparedRun).toBeNull();
  });

  it('includes workingDirectory from agentSettings when set', async () => {
    useAppStore.setState({ agentSettings: MOCK_SETTINGS as any });
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    await useAppStore.getState().prepareAgentRun('task-1', 'developer-agent');

    expect(api.generatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ workingDirectory: '' })
    );
  });
});

// ---------------------------------------------------------------------------
// executeAgentRun
// ---------------------------------------------------------------------------

describe('executeAgentRun', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
  });

  it('does nothing when preparedRun is null', async () => {
    useAppStore.setState({ preparedRun: null });
    const senderFn = vi.fn().mockReturnValue(true);
    mockActiveSendInput = vi.fn(() => senderFn);

    await useAppStore.getState().executeAgentRun();

    expect(senderFn).not.toHaveBeenCalled();
  });

  it('always dispatches to api.startRun (unified pipeline path) regardless of terminal state', async () => {
    // Terminal is open — PTY path no longer used; single-agent runs always go through the pipeline API.
    const senderFn = vi.fn().mockReturnValue(true);
    mockActiveSendInput = vi.fn(() => senderFn);
    useAppStore.setState({
      preparedRun: {
        taskId:          'task-1',
        agentId:         'developer-agent',
        spaceId:         'space-1',
        promptPath:      '/tmp/prompt.md',
        cliCommand:      'claude -p "$(cat \'/tmp/prompt.md\')"',
        promptPreview:   'preview',
        estimatedTokens: 100,
      },
    } as any);

    await useAppStore.getState().executeAgentRun();

    // PTY sender is NOT called — command goes through backend spawn instead.
    expect(senderFn).not.toHaveBeenCalled();
    // api.startRun is always called with the single agent as the stage list.
    expect(api.startRun).toHaveBeenCalledWith('space-1', 'task-1', ['developer-agent']);
  });

  it('sets activeRun with taskId, agentId, spaceId, cliCommand, promptPath', async () => {
    const senderFn = vi.fn().mockReturnValue(true);
    mockActiveSendInput = vi.fn(() => senderFn);
    useAppStore.setState({
      preparedRun: {
        taskId:          'task-1',
        agentId:         'developer-agent',
        spaceId:         'space-1',
        promptPath:      '/tmp/prompt.md',
        cliCommand:      'claude -p run',
        promptPreview:   'preview',
        estimatedTokens: 100,
      },
    } as any);

    await useAppStore.getState().executeAgentRun();

    const { activeRun } = useAppStore.getState();
    expect(activeRun).not.toBeNull();
    expect(activeRun?.taskId).toBe('task-1');
    expect(activeRun?.agentId).toBe('developer-agent');
    expect(activeRun?.cliCommand).toBe('claude -p run');
    expect(activeRun?.promptPath).toBe('/tmp/prompt.md');
  });

  it('clears preparedRun and closes promptPreviewOpen after execution', async () => {
    const senderFn = vi.fn().mockReturnValue(true);
    mockActiveSendInput = vi.fn(() => senderFn);
    useAppStore.setState({
      promptPreviewOpen: true,
      preparedRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        promptPath: '/tmp/prompt.md', cliCommand: 'claude run',
        promptPreview: 'preview', estimatedTokens: 100,
      },
    } as any);

    await useAppStore.getState().executeAgentRun();

    expect(useAppStore.getState().preparedRun).toBeNull();
    expect(useAppStore.getState().promptPreviewOpen).toBe(false);
  });

  it('shows error toast and does not set activeRun when api.startRun rejects', async () => {
    mockActiveSendInput = vi.fn(() => null);
    vi.mocked(api.startRun).mockRejectedValueOnce(new Error('server error'));
    useAppStore.setState({
      preparedRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        promptPath: '/tmp/prompt.md', cliCommand: 'claude run',
        promptPreview: 'preview', estimatedTokens: 100,
      },
    } as any);

    await useAppStore.getState().executeAgentRun();

    expect(useAppStore.getState().toast?.type).toBe('error');
    expect(useAppStore.getState().activeRun).toBeNull();
  });

  it('dispatches to backend spawn via api.startRun (unified path — terminal state is irrelevant)', async () => {
    mockActiveSendInput = vi.fn(() => null);
    useAppStore.setState({
      preparedRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        promptPath: '/tmp/prompt.md', cliCommand: 'claude run',
        promptPreview: 'preview', estimatedTokens: 100,
      },
    } as any);

    await useAppStore.getState().executeAgentRun();

    // Backend spawn path: api.startRun is called with the agent as the single stage.
    const { startRun } = await import('../../src/api/client');
    expect(startRun).toHaveBeenCalledWith('space-1', 'task-1', ['developer-agent']);

    // activeRun is set with a backendRunId.
    const { activeRun } = useAppStore.getState();
    expect(activeRun).not.toBeNull();
    expect(activeRun?.backendRunId).toBe('run-orch-1');
  });
});

// ---------------------------------------------------------------------------
// cancelAgentRun
// ---------------------------------------------------------------------------

describe('cancelAgentRun', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
  });

  it('sends Ctrl+C via activeSendInput and clears activeRun when connected', () => {
    const senderFn = vi.fn().mockReturnValue(true);
    mockActiveSendInput = vi.fn(() => senderFn);
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);

    useAppStore.getState().cancelAgentRun();

    expect(senderFn).toHaveBeenCalledWith('\x03');
    expect(useAppStore.getState().activeRun).toBeNull();
  });

  it('shows "Agent run cancelled." toast when activeSendInput is connected', () => {
    const senderFn = vi.fn().mockReturnValue(true);
    mockActiveSendInput = vi.fn(() => senderFn);
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);

    useAppStore.getState().cancelAgentRun();

    expect(useAppStore.getState().toast?.message).toContain('cancelled');
  });

  it('clears activeRun and shows disconnect toast when activeSendInput is null', () => {
    mockActiveSendInput = vi.fn(() => null);
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);

    useAppStore.getState().cancelAgentRun();

    expect(useAppStore.getState().activeRun).toBeNull();
    const { toast } = useAppStore.getState();
    expect(toast?.type).toBe('error');
    expect(toast?.message).toContain('cleared');
  });

  // BUG-001: poll interval must be cleared on cancel.
  it('clears _agentRunPollId and calls clearInterval on cancel (BUG-001)', () => {
    vi.useFakeTimers();
    const pollId = setInterval(() => {}, 5000);
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
      _agentRunPollId: pollId,
    } as any);

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    useAppStore.getState().cancelAgentRun();

    expect(clearIntervalSpy).toHaveBeenCalledWith(pollId);
    expect(useAppStore.getState()._agentRunPollId).toBeNull();

    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  // BUG-001: _agentRunPollId is null when no poll is running — cancel is safe.
  it('does not throw when _agentRunPollId is null on cancel (BUG-001)', () => {
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
      _agentRunPollId: null,
    } as any);

    expect(() => useAppStore.getState().cancelAgentRun()).not.toThrow();
    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });

  // BUG-002: pipelineState cleared synchronously for single-stage runs on cancel.
  it('clears pipelineState and closes log panel for single-stage backend run on cancel (BUG-002)', async () => {
    const { usePipelineLogStore } = await import('../../src/stores/usePipelineLogStore');
    const setLogPanelOpen = vi.spyOn(usePipelineLogStore.getState(), 'setLogPanelOpen');

    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
        backendRunId: 'run-backend-1',
      },
      pipelineState: {
        spaceId:           'space-1',
        taskId:            'task-1',
        stages:            ['developer-agent'],
        currentStageIndex: 0,
        startedAt:         new Date().toISOString(),
        status:            'running',
        runId:             'run-backend-1',
        subTaskIds:        [],
        checkpoints:       [],
      },
    } as any);

    useAppStore.getState().cancelAgentRun();

    expect(useAppStore.getState().pipelineState).toBeNull();
    expect(setLogPanelOpen).toHaveBeenCalledWith(false);

    setLogPanelOpen.mockRestore();
  });

  // BUG-002: pipelineState NOT cleared for multi-stage pipeline runs on cancel.
  it('does not clear pipelineState for multi-stage pipeline runs on cancel (BUG-002)', () => {
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
        backendRunId: 'run-backend-multi',
      },
      pipelineState: {
        spaceId:           'space-1',
        taskId:            'task-1',
        stages:            ['senior-architect', 'developer-agent'],
        currentStageIndex: 1,
        startedAt:         new Date().toISOString(),
        status:            'running',
        runId:             'run-backend-multi',
        subTaskIds:        [],
        checkpoints:       [],
      },
    } as any);

    useAppStore.getState().cancelAgentRun();

    // pipelineState must remain — multi-stage pipelines manage their own lifecycle.
    expect(useAppStore.getState().pipelineState).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startPipeline
// ---------------------------------------------------------------------------

const MOCK_SUB_TASK = {
  id: 'sub-task-1',
  title: 'Main Task / Stage 1: Senior Architect',
  type: 'chore' as const,
  assigned: 'senior-architect',
  description: 'Pipeline sub-task for stage 1. Parent task: task-main',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('startPipeline', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
    // Seed a main task in the todo column so resolveMainTaskTitle can find it
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Main Task', type: 'chore', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });
    vi.mocked(api.createTask).mockResolvedValue(MOCK_SUB_TASK);
  });

  it('sets pipelineState with status=running and currentStageIndex=0', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    const { pipelineState } = useAppStore.getState();
    expect(pipelineState?.status).toBe('running');
    expect(pipelineState?.currentStageIndex).toBe(0);
    expect(pipelineState?.spaceId).toBe('space-1');
  });

  it('uses default stages when agentSettings is null', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);
    useAppStore.setState({ agentSettings: null });

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    const { pipelineState } = useAppStore.getState();
    expect(pipelineState?.stages).toEqual([
      'senior-architect',
      'ux-api-designer',
      'developer-agent',
      'qa-engineer-e2e',
    ]);
  });

  it('uses stages from agentSettings.pipeline.stages', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);
    useAppStore.setState({ agentSettings: MOCK_SETTINGS as any });

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    const { pipelineState } = useAppStore.getState();
    expect(pipelineState?.stages).toEqual(MOCK_SETTINGS.pipeline.stages);
  });

  it('calls prepareAgentRun with the first stage', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    expect(api.generatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'senior-architect' })
    );
  });

  it('shows a "Pipeline started" toast', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    expect(useAppStore.getState().toast?.message).toContain('Pipeline started');
  });
});

// ---------------------------------------------------------------------------
// advancePipeline
// ---------------------------------------------------------------------------

describe('advancePipeline', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
    vi.mocked(api.createTask).mockResolvedValue({
      id: 'sub-task-2',
      title: 'Main Task / Stage 2: Developer',
      type: 'chore',
      assigned: 'developer-agent',
      description: 'Pipeline sub-task for stage 2. Parent task: task-main',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it('does nothing when pipelineState is null', async () => {
    useAppStore.setState({ pipelineState: null });
    await useAppStore.getState().advancePipeline();
    expect(api.generatePrompt).not.toHaveBeenCalled();
  });

  it('does nothing when pipelineState.status is not running', async () => {
    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1', taskId: 'task-main', subTaskIds: ['sub-task-1'],
        stages: ['senior-architect', 'developer-agent'] as any,
        currentStageIndex: 0, startedAt: new Date().toISOString(), status: 'completed',
      },
    } as any);
    await useAppStore.getState().advancePipeline();
    expect(api.generatePrompt).not.toHaveBeenCalled();
  });

  it('increments currentStageIndex and calls prepareAgentRun for next stage', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);
    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1',
        taskId: 'task-main',
        subTaskIds: ['sub-task-1'],
        stages: ['senior-architect', 'developer-agent'] as any,
        currentStageIndex: 0,
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    } as any);

    await useAppStore.getState().advancePipeline();

    expect(useAppStore.getState().pipelineState?.currentStageIndex).toBe(1);
    expect(api.generatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'developer-agent' })
    );
  });

  it('sets status=completed and shows completion toast when last stage finishes', async () => {
    vi.useFakeTimers();
    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1',
        taskId: 'task-main',
        subTaskIds: ['sub-task-1', 'sub-task-2'],
        stages: ['senior-architect', 'developer-agent'] as any,
        currentStageIndex: 1, // already at last stage
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    } as any);

    await useAppStore.getState().advancePipeline();

    expect(useAppStore.getState().pipelineState?.status).toBe('completed');
    expect(useAppStore.getState().toast?.message).toContain('complete');

    // After 3 seconds, pipelineState auto-clears
    vi.advanceTimersByTime(3001);
    expect(useAppStore.getState().pipelineState).toBeNull();
    vi.useRealTimers();
  });

  it('shows stage advancement toast', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);
    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1',
        taskId: 'task-main',
        subTaskIds: ['sub-task-1'],
        stages: ['senior-architect', 'developer-agent', 'qa-engineer-e2e'] as any,
        currentStageIndex: 0,
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    } as any);

    await useAppStore.getState().advancePipeline();

    expect(useAppStore.getState().toast?.message).toContain('Stage 2');
  });
});

// ---------------------------------------------------------------------------
// abortPipeline
// ---------------------------------------------------------------------------

describe('abortPipeline', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
  });

  it('does nothing when pipelineState is null', () => {
    useAppStore.setState({ pipelineState: null });
    useAppStore.getState().abortPipeline();
    // No error thrown, no state change needed
    expect(useAppStore.getState().pipelineState).toBeNull();
  });

  it('sends Ctrl+C via activeSendInput when connected', () => {
    const senderFn = vi.fn().mockReturnValue(true);
    mockActiveSendInput = vi.fn(() => senderFn);
    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1',
        stages: ['senior-architect', 'developer-agent'] as any,
        currentStageIndex: 1,
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    } as any);

    useAppStore.getState().abortPipeline();

    expect(senderFn).toHaveBeenCalledWith('\x03');
  });

  it('clears pipelineState and activeRun', () => {
    mockActiveSendInput = vi.fn(() => null);
    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1',
        stages: ['senior-architect', 'developer-agent'] as any,
        currentStageIndex: 0,
        startedAt: new Date().toISOString(),
        status: 'running',
      },
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);

    useAppStore.getState().abortPipeline();

    expect(useAppStore.getState().pipelineState).toBeNull();
    expect(useAppStore.getState().activeRun).toBeNull();
  });

  it('shows abort toast with the current stage number', () => {
    mockActiveSendInput = vi.fn(() => null);
    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1',
        stages: ['senior-architect', 'developer-agent', 'qa-engineer-e2e'] as any,
        currentStageIndex: 2,
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    } as any);

    useAppStore.getState().abortPipeline();

    // currentStageIndex=2 → stage 3
    expect(useAppStore.getState().toast?.message).toContain('stage 3');
  });
});

// ---------------------------------------------------------------------------
// loadSettings
// ---------------------------------------------------------------------------

describe('loadSettings', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
  });

  it('calls api.getSettings and sets agentSettings in state', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(MOCK_SETTINGS as any);

    await useAppStore.getState().loadSettings();

    expect(api.getSettings).toHaveBeenCalledOnce();
    expect(useAppStore.getState().agentSettings).toEqual(MOCK_SETTINGS);
  });

  it('sets settingsLoading to false after completion', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(MOCK_SETTINGS as any);

    await useAppStore.getState().loadSettings();

    expect(useAppStore.getState().settingsLoading).toBe(false);
  });

  it('shows error toast on failure', async () => {
    vi.mocked(api.getSettings).mockRejectedValue(new Error('SETTINGS_READ_ERROR'));

    await useAppStore.getState().loadSettings();

    const { toast } = useAppStore.getState();
    expect(toast?.type).toBe('error');
    expect(toast?.message).toContain('Failed to load settings');
  });

  it('sets settingsLoading to false even on failure', async () => {
    vi.mocked(api.getSettings).mockRejectedValue(new Error('fail'));

    await useAppStore.getState().loadSettings();

    expect(useAppStore.getState().settingsLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// saveSettings
// ---------------------------------------------------------------------------

describe('saveSettings', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
  });

  it('calls api.saveSettings with the partial settings object', async () => {
    const partial = { cli: { tool: 'opencode' as const } };
    vi.mocked(api.saveSettings).mockResolvedValue(MOCK_SETTINGS as any);

    await useAppStore.getState().saveSettings(partial as any);

    expect(api.saveSettings).toHaveBeenCalledWith(partial);
  });

  it('updates agentSettings with the server-returned merged settings', async () => {
    const updated = { ...MOCK_SETTINGS, cli: { ...MOCK_SETTINGS.cli, tool: 'opencode' as const } };
    vi.mocked(api.saveSettings).mockResolvedValue(updated as any);

    await useAppStore.getState().saveSettings({ cli: { tool: 'opencode' } } as any);

    expect(useAppStore.getState().agentSettings?.cli.tool).toBe('opencode');
  });

  it('shows "Settings saved." toast on success', async () => {
    vi.mocked(api.saveSettings).mockResolvedValue(MOCK_SETTINGS as any);

    await useAppStore.getState().saveSettings({});

    expect(useAppStore.getState().toast?.message).toBe('Settings saved.');
  });

  it('shows error toast on failure', async () => {
    vi.mocked(api.saveSettings).mockRejectedValue(new Error('SETTINGS_WRITE_ERROR'));

    await useAppStore.getState().saveSettings({});

    const { toast } = useAppStore.getState();
    expect(toast?.type).toBe('error');
    expect(toast?.message).toContain('Failed to save settings');
  });

  it('does not update agentSettings on failure', async () => {
    useAppStore.setState({ agentSettings: MOCK_SETTINGS as any });
    vi.mocked(api.saveSettings).mockRejectedValue(new Error('fail'));

    await useAppStore.getState().saveSettings({});

    expect(useAppStore.getState().agentSettings).toEqual(MOCK_SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// T-006: resolveMainTaskTitle — searches all columns + fallback
// ---------------------------------------------------------------------------

describe('resolveMainTaskTitle (via startPipeline)', () => {
  // resolveMainTaskTitle is a private module function, exercised indirectly
  // through startPipeline which uses it to build the sub-task title.
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);
    vi.mocked(api.createTask).mockResolvedValue({
      id: 'sub-task-1', title: '', type: 'chore',
      createdAt: '', updatedAt: '',
    });
  });

  it('finds the main task title in the todo column', async () => {
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Todo Task', type: 'chore', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    expect(api.createTask).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({ title: expect.stringContaining('Todo Task') }),
    );
  });

  it('finds the main task title in the in-progress column', async () => {
    useAppStore.setState({
      tasks: {
        todo: [],
        'in-progress': [{ id: 'task-main', title: 'InProgress Task', type: 'chore', createdAt: '', updatedAt: '' }],
        done: [],
      },
    });

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    expect(api.createTask).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({ title: expect.stringContaining('InProgress Task') }),
    );
  });

  it('finds the main task title in the done column', async () => {
    useAppStore.setState({
      tasks: {
        todo: [],
        'in-progress': [],
        done: [{ id: 'task-main', title: 'Done Task', type: 'chore', createdAt: '', updatedAt: '' }],
      },
    });

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    expect(api.createTask).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({ title: expect.stringContaining('Done Task') }),
    );
  });

  it('uses the fallback title "Task <id>" when task is not in any column', async () => {
    useAppStore.setState({
      tasks: { todo: [], 'in-progress': [], done: [] },
    });

    await useAppStore.getState().startPipeline('space-1', 'task-missing');

    expect(api.createTask).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({ title: expect.stringContaining('Task task-missing') }),
    );
  });

  it('startPipeline initialises subTaskIds with the new sub-task ID', async () => {
    vi.mocked(api.createTask).mockResolvedValue({
      id: 'new-sub-001', title: '', type: 'chore', createdAt: '', updatedAt: '',
    });
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Main', type: 'chore', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    expect(useAppStore.getState().pipelineState?.subTaskIds).toEqual(['new-sub-001']);
  });

  it('startPipeline calls prepareAgentRun with the sub-task ID, not the main task ID', async () => {
    vi.mocked(api.createTask).mockResolvedValue({
      id: 'sub-xyz', title: '', type: 'chore', createdAt: '', updatedAt: '',
    });
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Main', type: 'chore', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    // prepareAgentRun is implemented via api.generatePrompt — verify it received sub-task ID
    expect(api.generatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'sub-xyz' }),
    );
    // It must NOT have been called with the main task ID
    expect(api.generatePrompt).not.toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-main' }),
    );
  });
});

// ---------------------------------------------------------------------------
// T-007: startPipeline and advancePipeline error paths
// ---------------------------------------------------------------------------

describe('startPipeline — createTask failure', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Main', type: 'chore', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });
  });

  it('sets pipelineState to null when createTask fails', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Network error'));

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    expect(useAppStore.getState().pipelineState).toBeNull();
  });

  it('shows an error toast with "stage 1" in the message when createTask fails', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Network error'));

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    const { toast } = useAppStore.getState();
    expect(toast?.type).toBe('error');
    expect(toast?.message).toContain('stage 1');
  });

  it('does not call generatePrompt when createTask fails', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Network error'));

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    expect(api.generatePrompt).not.toHaveBeenCalled();
  });
});

describe('advancePipeline — createTask failure', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1',
        taskId: 'task-main',
        subTaskIds: ['sub-task-1'],
        stages: ['senior-architect', 'developer-agent', 'qa-engineer-e2e'] as any,
        currentStageIndex: 0,
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    } as any);
  });

  it('sets pipelineState to null when createTask fails in advancePipeline', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Server error'));

    await useAppStore.getState().advancePipeline();

    expect(useAppStore.getState().pipelineState).toBeNull();
  });

  it('shows an error toast containing the stage number when createTask fails', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Server error'));

    await useAppStore.getState().advancePipeline();

    const { toast } = useAppStore.getState();
    expect(toast?.type).toBe('error');
    // stage 2 = currentStageIndex 0 + 1 + 1
    expect(toast?.message).toContain('stage 2');
  });

  it('does not call generatePrompt when createTask fails in advancePipeline', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Server error'));

    await useAppStore.getState().advancePipeline();

    expect(api.generatePrompt).not.toHaveBeenCalled();
  });

  it('subTaskIds grows by exactly one on successful advancePipeline', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);
    vi.mocked(api.createTask).mockResolvedValue({
      id: 'sub-task-2', title: '', type: 'chore', createdAt: '', updatedAt: '',
    });

    await useAppStore.getState().advancePipeline();

    expect(useAppStore.getState().pipelineState?.subTaskIds).toEqual(['sub-task-1', 'sub-task-2']);
  });

  it('prepareAgentRun receives the new sub-task ID, not the main task ID', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);
    vi.mocked(api.createTask).mockResolvedValue({
      id: 'sub-task-stage2', title: '', type: 'chore', createdAt: '', updatedAt: '',
    });

    await useAppStore.getState().advancePipeline();

    expect(api.generatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'sub-task-stage2' }),
    );
    expect(api.generatePrompt).not.toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-main' }),
    );
  });
});

// ---------------------------------------------------------------------------
// T-3: startPipeline with checkpoints — pause on stage 0
// ---------------------------------------------------------------------------

describe('startPipeline — checkpoint on stage 0', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Main Task', type: 'chore', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });
  });

  it('sets status to paused when checkpoint 0 is in the list', async () => {
    await useAppStore.getState().startPipeline('space-1', 'task-main', undefined, [0]);

    const ps = useAppStore.getState().pipelineState;
    expect(ps?.status).toBe('paused');
    expect(ps?.pausedBeforeStage).toBe(0);
  });

  it('does not create a sub-task when pausing at stage 0', async () => {
    await useAppStore.getState().startPipeline('space-1', 'task-main', undefined, [0]);

    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('does not call generatePrompt when pausing at stage 0', async () => {
    await useAppStore.getState().startPipeline('space-1', 'task-main', undefined, [0]);

    expect(api.generatePrompt).not.toHaveBeenCalled();
  });

  it('stores the checkpoints array in pipelineState', async () => {
    await useAppStore.getState().startPipeline('space-1', 'task-main', undefined, [0, 2]);

    const ps = useAppStore.getState().pipelineState;
    expect(ps?.checkpoints).toEqual([0, 2]);
  });

  it('shows a toast mentioning the paused stage', async () => {
    await useAppStore.getState().startPipeline('space-1', 'task-main', undefined, [0]);

    expect(useAppStore.getState().toast?.message).toContain('paused');
  });
});

// ---------------------------------------------------------------------------
// T-3: advancePipeline with checkpoints — pause mid-pipeline
// ---------------------------------------------------------------------------

describe('advancePipeline — checkpoint on next stage', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Main Task', type: 'chore', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
      pipelineState: {
        spaceId:           'space-1',
        taskId:            'task-main',
        subTaskIds:        ['sub-task-1'],
        stages:            ['senior-architect', 'developer-agent', 'qa-engineer-e2e'] as any,
        currentStageIndex: 0,
        startedAt:         new Date().toISOString(),
        status:            'running',
        checkpoints:       [1],  // pause before stage index 1 (developer-agent)
      } as any,
    });
  });

  it('sets status to paused when nextIndex is in checkpoints', async () => {
    await useAppStore.getState().advancePipeline();

    const ps = useAppStore.getState().pipelineState;
    expect(ps?.status).toBe('paused');
    expect(ps?.pausedBeforeStage).toBe(1);
    expect(ps?.currentStageIndex).toBe(1);
  });

  it('does not create a sub-task when pausing mid-pipeline', async () => {
    await useAppStore.getState().advancePipeline();

    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('does not call generatePrompt when pausing mid-pipeline', async () => {
    await useAppStore.getState().advancePipeline();

    expect(api.generatePrompt).not.toHaveBeenCalled();
  });

  it('shows a toast mentioning the paused stage index', async () => {
    await useAppStore.getState().advancePipeline();

    expect(useAppStore.getState().toast?.message).toContain('paused');
  });
});

// ---------------------------------------------------------------------------
// T-3: resumePipeline
// ---------------------------------------------------------------------------

describe('resumePipeline', () => {
  beforeEach(() => {
    resetLauncherStore();
    vi.clearAllMocks();
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Main Task', type: 'chore', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });
  });

  it('does nothing when pipelineState is null', async () => {
    useAppStore.setState({ pipelineState: null });
    await useAppStore.getState().resumePipeline();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('does nothing when status is running (not paused)', async () => {
    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1', taskId: 'task-main', subTaskIds: [],
        stages: ['senior-architect'] as any,
        currentStageIndex: 0, startedAt: new Date().toISOString(),
        status: 'running', checkpoints: [],
      } as any,
    });
    await useAppStore.getState().resumePipeline();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('sets status back to running when resuming stage 0 checkpoint', async () => {
    vi.mocked(api.createTask).mockResolvedValue({ id: 'sub-1', title: '', type: 'chore', createdAt: '', updatedAt: '' });
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1', taskId: 'task-main', subTaskIds: [],
        stages: ['senior-architect', 'developer-agent'] as any,
        currentStageIndex: 0, startedAt: new Date().toISOString(),
        status: 'paused', checkpoints: [0], pausedBeforeStage: 0,
      } as any,
    });

    await useAppStore.getState().resumePipeline();

    expect(useAppStore.getState().pipelineState?.status).toBe('running');
  });

  it('removes the consumed checkpoint so the same stage does not pause again', async () => {
    vi.mocked(api.createTask).mockResolvedValue({ id: 'sub-1', title: '', type: 'chore', createdAt: '', updatedAt: '' });
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1', taskId: 'task-main', subTaskIds: [],
        stages: ['senior-architect', 'developer-agent'] as any,
        currentStageIndex: 0, startedAt: new Date().toISOString(),
        status: 'paused', checkpoints: [0, 1], pausedBeforeStage: 0,
      } as any,
    });

    await useAppStore.getState().resumePipeline();

    // Checkpoint 0 consumed; checkpoint 1 remains.
    expect(useAppStore.getState().pipelineState?.checkpoints).toEqual([1]);
  });

  it('creates a sub-task and calls generatePrompt when resuming stage 0', async () => {
    vi.mocked(api.createTask).mockResolvedValue({ id: 'sub-resume-0', title: '', type: 'chore', createdAt: '', updatedAt: '' });
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1', taskId: 'task-main', subTaskIds: [],
        stages: ['senior-architect', 'developer-agent'] as any,
        currentStageIndex: 0, startedAt: new Date().toISOString(),
        status: 'paused', checkpoints: [0], pausedBeforeStage: 0,
      } as any,
    });

    await useAppStore.getState().resumePipeline();

    expect(api.createTask).toHaveBeenCalledOnce();
    expect(api.generatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'sub-resume-0' }),
    );
  });

  it('creates a sub-task for mid-pipeline resume (stage 1)', async () => {
    vi.mocked(api.createTask).mockResolvedValue({ id: 'sub-resume-mid', title: '', type: 'chore', createdAt: '', updatedAt: '' });
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);

    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1', taskId: 'task-main', subTaskIds: ['sub-0'],
        stages: ['senior-architect', 'developer-agent', 'qa-engineer-e2e'] as any,
        currentStageIndex: 1, startedAt: new Date().toISOString(),
        status: 'paused', checkpoints: [1], pausedBeforeStage: 1,
      } as any,
    });

    await useAppStore.getState().resumePipeline();

    expect(api.createTask).toHaveBeenCalledOnce();
    expect(api.generatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'sub-resume-mid' }),
    );
  });

  it('aborts and shows error toast when createTask fails during resume', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('DB error'));

    useAppStore.setState({
      pipelineState: {
        spaceId: 'space-1', taskId: 'task-main', subTaskIds: [],
        stages: ['senior-architect'] as any,
        currentStageIndex: 0, startedAt: new Date().toISOString(),
        status: 'paused', checkpoints: [0], pausedBeforeStage: 0,
      } as any,
    });

    await useAppStore.getState().resumePipeline();

    expect(useAppStore.getState().pipelineState).toBeNull();
    expect(useAppStore.getState().toast?.type).toBe('error');
  });
});
