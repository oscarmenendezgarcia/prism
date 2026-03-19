/**
 * Component tests for AgentPromptPreview modal.
 * T-024: modal visibility, CLI command display, prompt preview, token badge,
 *        Execute / Cancel actions, Copy button, edit mode.
 *
 * NOTE: The Modal component uses createPortal → renders into document.body,
 * not the render container. Always query via document.body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentPromptPreview } from '../../src/components/agent-launcher/AgentPromptPreview';
import { useAppStore } from '../../src/stores/useAppStore';
import type { PreparedRun, AgentInfo } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock the API client.
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
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_AGENTS: AgentInfo[] = [
  {
    id:          'senior-architect',
    name:        'senior-architect.md',
    displayName: 'Senior Architect',
    path:        '/home/.claude/agents/senior-architect.md',
    sizeBytes:   11400,
  },
];

const PREPARED_RUN: PreparedRun = {
  taskId:          'task-123',
  agentId:         'senior-architect',
  spaceId:         'space-456',
  promptPath:      '/data/.prompts/prompt-1234567890-task123.md',
  cliCommand:      'claude -p "$(cat /data/.prompts/prompt-1234567890-task123.md)" --allowedTools "Agent,Bash,Read,Write,Edit,Glob,Grep"',
  promptPreview:   '## TASK CONTEXT\nTitle: Implement feature X\nType: task\nColumn: todo\nSpace: My Project',
  estimatedTokens: 2400,
};

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    preparedRun:       null,
    promptPreviewOpen: false,
    availableAgents:   [],
    activeRun:         null,
    executeAgentRun:   vi.fn().mockResolvedValue(undefined),
    clearPreparedRun:  vi.fn(),
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

function renderPreview() {
  return render(<AgentPromptPreview />);
}

// The modal renders into document.body via createPortal.
function queryModal() {
  return document.body.querySelector('[role="dialog"]');
}

// ---------------------------------------------------------------------------
// Tests: modal visibility
// ---------------------------------------------------------------------------

describe('AgentPromptPreview — modal visibility', () => {
  it('renders nothing when preparedRun is null', () => {
    resetStore({ preparedRun: null, promptPreviewOpen: false });
    renderPreview();
    expect(queryModal()).not.toBeInTheDocument();
  });

  it('renders nothing when promptPreviewOpen is false even if preparedRun is set', () => {
    resetStore({ preparedRun: PREPARED_RUN, promptPreviewOpen: false });
    renderPreview();
    expect(queryModal()).not.toBeInTheDocument();
  });

  it('renders the modal when preparedRun is set and promptPreviewOpen is true', () => {
    resetStore({ preparedRun: PREPARED_RUN, promptPreviewOpen: true });
    renderPreview();
    expect(queryModal()).toBeInTheDocument();
  });

  it('shows the agent displayName in the modal title when availableAgents is populated', () => {
    resetStore({
      preparedRun:       PREPARED_RUN,
      promptPreviewOpen: true,
      availableAgents:   SAMPLE_AGENTS,
    });
    renderPreview();
    expect(document.body).toHaveTextContent('Run Senior Architect');
  });

  it('falls back to agentId in title when agent not in availableAgents', () => {
    resetStore({
      preparedRun:       PREPARED_RUN,
      promptPreviewOpen: true,
      availableAgents:   [],
    });
    renderPreview();
    // Falls back to agentId string.
    expect(document.body).toHaveTextContent('senior-architect');
  });
});

// ---------------------------------------------------------------------------
// Tests: content sections
// ---------------------------------------------------------------------------

describe('AgentPromptPreview — CLI command section', () => {
  beforeEach(() => {
    resetStore({ preparedRun: PREPARED_RUN, promptPreviewOpen: true });
  });

  it('displays the CLI Command section label', () => {
    renderPreview();
    expect(document.body).toHaveTextContent('CLI Command');
  });

  it('displays the full cliCommand text', () => {
    renderPreview();
    expect(document.body).toHaveTextContent(PREPARED_RUN.cliCommand);
  });

  it('renders a Copy button', () => {
    renderPreview();
    const copyBtn = document.body.querySelector('[aria-label="Copy CLI command to clipboard"]');
    expect(copyBtn).toBeInTheDocument();
  });
});

describe('AgentPromptPreview — prompt preview section', () => {
  beforeEach(() => {
    resetStore({ preparedRun: PREPARED_RUN, promptPreviewOpen: true });
  });

  it('displays the Prompt Preview section label', () => {
    renderPreview();
    expect(document.body).toHaveTextContent('Prompt Preview');
  });

  it('shows the promptPreview content in the textarea', () => {
    renderPreview();
    const textarea = document.body.querySelector('textarea');
    expect(textarea).toBeInTheDocument();
    expect(textarea!.value).toContain('## TASK CONTEXT');
  });

  it('textarea is read-only by default', () => {
    renderPreview();
    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
  });
});

describe('AgentPromptPreview — token badge', () => {
  it('displays estimated token count badge for values >= 1000', () => {
    resetStore({ preparedRun: PREPARED_RUN, promptPreviewOpen: true });
    renderPreview();
    // 2400 tokens → "~2.4k tokens"
    expect(document.body).toHaveTextContent('~2.4k tokens');
  });

  it('displays exact count for values < 1000', () => {
    const smallRun: PreparedRun = { ...PREPARED_RUN, estimatedTokens: 350 };
    resetStore({ preparedRun: smallRun, promptPreviewOpen: true });
    renderPreview();
    expect(document.body).toHaveTextContent('~350 tokens');
  });
});

// ---------------------------------------------------------------------------
// Tests: Execute action
// ---------------------------------------------------------------------------

describe('AgentPromptPreview — Execute button', () => {
  it('renders an Execute button', () => {
    resetStore({ preparedRun: PREPARED_RUN, promptPreviewOpen: true });
    renderPreview();
    const executeBtn = document.body.querySelector('[aria-label=""], button') as HTMLElement;
    expect(document.body).toHaveTextContent('Execute');
  });

  it('calls executeAgentRun when Execute is clicked', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    resetStore({
      preparedRun:       PREPARED_RUN,
      promptPreviewOpen: true,
      executeAgentRun:   mockExecute,
    });
    renderPreview();

    const executeBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Execute')
    );
    expect(executeBtn).toBeTruthy();
    fireEvent.click(executeBtn!);

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Cancel action
// ---------------------------------------------------------------------------

describe('AgentPromptPreview — Cancel button', () => {
  it('renders a Cancel button', () => {
    resetStore({ preparedRun: PREPARED_RUN, promptPreviewOpen: true });
    renderPreview();
    expect(document.body).toHaveTextContent('Cancel');
  });

  it('calls clearPreparedRun when Cancel is clicked', () => {
    const mockClear = vi.fn();
    resetStore({
      preparedRun:       PREPARED_RUN,
      promptPreviewOpen: true,
      clearPreparedRun:  mockClear,
    });
    renderPreview();

    const cancelBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel'
    );
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn!);

    expect(mockClear).toHaveBeenCalledOnce();
  });

  it('calls clearPreparedRun when the modal close (×) button is clicked', () => {
    const mockClear = vi.fn();
    resetStore({
      preparedRun:       PREPARED_RUN,
      promptPreviewOpen: true,
      clearPreparedRun:  mockClear,
    });
    renderPreview();

    const closeBtn = document.body.querySelector('[aria-label="Close modal"]') as HTMLElement;
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);

    expect(mockClear).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests: Edit mode
// ---------------------------------------------------------------------------

describe('AgentPromptPreview — edit mode', () => {
  beforeEach(() => {
    resetStore({ preparedRun: PREPARED_RUN, promptPreviewOpen: true });
  });

  it('renders an Edit button', () => {
    renderPreview();
    const editBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Edit'
    );
    expect(editBtn).toBeTruthy();
  });

  it('clicking Edit switches textarea to editable mode', () => {
    renderPreview();

    const editBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Edit'
    )!;
    fireEvent.click(editBtn);

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(false);
  });

  it('shows "Edited" label after entering edit mode', () => {
    renderPreview();
    const editBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Edit'
    )!;
    fireEvent.click(editBtn);
    expect(document.body).toHaveTextContent('Edited');
  });

  it('edit button changes to "Done editing" when in edit mode', () => {
    renderPreview();
    const editBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Edit'
    )!;
    fireEvent.click(editBtn);

    const doneBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Done editing'
    );
    expect(doneBtn).toBeTruthy();
  });

  it('shows "Preview only" note when in edit mode', () => {
    renderPreview();
    const editBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Edit'
    )!;
    fireEvent.click(editBtn);
    expect(document.body).toHaveTextContent('Preview only');
  });
});

// ---------------------------------------------------------------------------
// Tests: Copy button (clipboard API mock)
// ---------------------------------------------------------------------------

describe('AgentPromptPreview — Copy button', () => {
  it('Copy button changes to "Copied" after clicking', async () => {
    // Mock clipboard API.
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: mockWriteText },
    });

    resetStore({ preparedRun: PREPARED_RUN, promptPreviewOpen: true });
    renderPreview();

    const copyBtn = document.body.querySelector('[aria-label="Copy CLI command to clipboard"]') as HTMLElement;
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith(PREPARED_RUN.cliCommand);
    });

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Copied');
    });
  });
});
