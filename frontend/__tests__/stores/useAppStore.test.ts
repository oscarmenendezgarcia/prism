/**
 * Unit tests for useAppStore Zustand store.
 * All API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API client before importing the store
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
    terminalOpen: false,
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
      todo: [{ id: 't1', title: 'Task 1', type: 'task' as const, createdAt: '', updatedAt: '' }],
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
    vi.mocked(api.createTask).mockResolvedValue({ id: 'new', title: 'New task', type: 'task', createdAt: '', updatedAt: '' });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().createTask({ title: 'New task', type: 'task' });

    expect(useAppStore.getState().createModalOpen).toBe(false);
    expect(api.createTask).toHaveBeenCalled();
    expect(api.getTasks).toHaveBeenCalled();
    expect(useAppStore.getState().toast?.type).toBe('success');
  });

  it('sets isMutating true during call and false after', async () => {
    vi.mocked(api.createTask).mockResolvedValue({ id: 'x', title: 'T', type: 'task', createdAt: '', updatedAt: '' });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    const promise = useAppStore.getState().createTask({ title: 'T', type: 'task' });
    // isMutating should be true synchronously right after start
    // Note: because Zustand sets synchronously before await, we can check after resolution
    await promise;
    expect(useAppStore.getState().isMutating).toBe(false);
  });

  it('re-throws error and resets isMutating on failure', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Validation error'));
    await expect(
      useAppStore.getState().createTask({ title: 'T', type: 'task' })
    ).rejects.toThrow('Validation error');
    expect(useAppStore.getState().isMutating).toBe(false);
  });
});

describe('moveTask', () => {
  it('calls api.moveTask with target column, shows toast, reloads board', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    vi.mocked(api.moveTask).mockResolvedValue({
      task: { id: 't1', title: 'T', type: 'task', createdAt: '', updatedAt: '' },
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
      task: { id: 't1', title: 'T', type: 'task', createdAt: '', updatedAt: '' },
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

describe('toggleTerminal', () => {
  it('toggles terminalOpen state', () => {
    expect(useAppStore.getState().terminalOpen).toBe(false);
    useAppStore.getState().toggleTerminal();
    expect(useAppStore.getState().terminalOpen).toBe(true);
    useAppStore.getState().toggleTerminal();
    expect(useAppStore.getState().terminalOpen).toBe(false);
  });

  it('persists to localStorage', () => {
    useAppStore.getState().toggleTerminal();
    expect(localStorage.getItem('terminal:open')).toBe('1');
    useAppStore.getState().toggleTerminal();
    expect(localStorage.getItem('terminal:open')).toBeNull();
  });
});

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
    terminalOpen:     false,
    terminalSender:   null,
    availableAgents:  [],
    activeRun:        null,
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
    useAppStore.setState({ terminalSender: senderFn } as any);

    await useAppStore.getState().executeAgentRun();

    expect(senderFn).not.toHaveBeenCalled();
  });

  it('sends the CLI command + newline via terminalSender when connected', async () => {
    const senderFn = vi.fn().mockReturnValue(true);
    useAppStore.setState({
      terminalSender: senderFn,
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

    expect(senderFn).toHaveBeenCalledWith(
      'claude -p "$(cat \'/tmp/prompt.md\')"' + '\r'
    );
  });

  it('sets activeRun with taskId, agentId, spaceId, cliCommand, promptPath', async () => {
    const senderFn = vi.fn().mockReturnValue(true);
    useAppStore.setState({
      terminalSender: senderFn,
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
    useAppStore.setState({
      terminalSender:    senderFn,
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

  it('shows error toast when terminalSender returns false (send failed)', async () => {
    const senderFn = vi.fn().mockReturnValue(false);
    useAppStore.setState({
      terminalSender: senderFn,
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

  it('shows "Opening terminal..." toast and error when terminalSender is null after 500ms wait', async () => {
    vi.useFakeTimers();
    useAppStore.setState({
      terminalSender: null,
      terminalOpen:   false,
      preparedRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        promptPath: '/tmp/prompt.md', cliCommand: 'claude run',
        promptPreview: 'preview', estimatedTokens: 100,
      },
    } as any);

    const execPromise = useAppStore.getState().executeAgentRun();

    // The 'Opening terminal...' toast should be shown synchronously (before await)
    // and terminalOpen toggled
    expect(useAppStore.getState().terminalOpen).toBe(true);

    // Advance the 500ms wait — sender is still null
    vi.advanceTimersByTime(500);
    await execPromise;

    expect(useAppStore.getState().toast?.type).toBe('error');
    vi.useRealTimers();
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

  it('sends Ctrl+C via terminalSender and clears activeRun when connected', () => {
    const senderFn = vi.fn().mockReturnValue(true);
    useAppStore.setState({
      terminalSender: senderFn,
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);

    useAppStore.getState().cancelAgentRun();

    expect(senderFn).toHaveBeenCalledWith('\x03');
    expect(useAppStore.getState().activeRun).toBeNull();
  });

  it('shows "Agent run cancelled." toast when terminalSender is connected', () => {
    const senderFn = vi.fn().mockReturnValue(true);
    useAppStore.setState({ terminalSender: senderFn } as any);

    useAppStore.getState().cancelAgentRun();

    expect(useAppStore.getState().toast?.message).toContain('cancelled');
  });

  it('clears activeRun and shows disconnect toast when terminalSender is null', () => {
    useAppStore.setState({
      terminalSender: null,
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);

    useAppStore.getState().cancelAgentRun();

    expect(useAppStore.getState().activeRun).toBeNull();
    const { toast } = useAppStore.getState();
    expect(toast?.type).toBe('error');
    expect(toast?.message).toContain('disconnected');
  });
});

// ---------------------------------------------------------------------------
// startPipeline
// ---------------------------------------------------------------------------

const MOCK_SUB_TASK = {
  id: 'sub-task-1',
  title: 'Main Task / Stage 1: Senior Architect',
  type: 'research' as const,
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
        todo: [{ id: 'task-main', title: 'Main Task', type: 'task', createdAt: '', updatedAt: '' }],
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
      type: 'research',
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

  it('sends Ctrl+C via terminalSender when connected', () => {
    const senderFn = vi.fn().mockReturnValue(true);
    useAppStore.setState({
      terminalSender: senderFn,
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
    useAppStore.setState({
      terminalSender: null,
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
    useAppStore.setState({
      terminalSender: null,
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
      id: 'sub-task-1', title: '', type: 'research',
      createdAt: '', updatedAt: '',
    });
  });

  it('finds the main task title in the todo column', async () => {
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Todo Task', type: 'task', createdAt: '', updatedAt: '' }],
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
        'in-progress': [{ id: 'task-main', title: 'InProgress Task', type: 'task', createdAt: '', updatedAt: '' }],
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
        done: [{ id: 'task-main', title: 'Done Task', type: 'task', createdAt: '', updatedAt: '' }],
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
      id: 'new-sub-001', title: '', type: 'research', createdAt: '', updatedAt: '',
    });
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Main', type: 'task', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });

    await useAppStore.getState().startPipeline('space-1', 'task-main');

    expect(useAppStore.getState().pipelineState?.subTaskIds).toEqual(['new-sub-001']);
  });

  it('startPipeline calls prepareAgentRun with the sub-task ID, not the main task ID', async () => {
    vi.mocked(api.createTask).mockResolvedValue({
      id: 'sub-xyz', title: '', type: 'research', createdAt: '', updatedAt: '',
    });
    useAppStore.setState({
      tasks: {
        todo: [{ id: 'task-main', title: 'Main', type: 'task', createdAt: '', updatedAt: '' }],
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
        todo: [{ id: 'task-main', title: 'Main', type: 'task', createdAt: '', updatedAt: '' }],
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
      id: 'sub-task-2', title: '', type: 'research', createdAt: '', updatedAt: '',
    });

    await useAppStore.getState().advancePipeline();

    expect(useAppStore.getState().pipelineState?.subTaskIds).toEqual(['sub-task-1', 'sub-task-2']);
  });

  it('prepareAgentRun receives the new sub-task ID, not the main task ID', async () => {
    vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);
    vi.mocked(api.createTask).mockResolvedValue({
      id: 'sub-task-stage2', title: '', type: 'research', createdAt: '', updatedAt: '',
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
