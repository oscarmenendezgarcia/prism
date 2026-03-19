/**
 * Unit tests for the agent launcher API client functions.
 * T-021: getAgents, getAgent, generatePrompt, getSettings, saveSettings.
 *
 * Strategy: vi.stubGlobal('fetch', ...) intercepts every call.
 * Each describe block verifies URL, HTTP method, body, and response parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAgents,
  getAgent,
  generatePrompt,
  getSettings,
  saveSettings,
} from '../../src/api/client';
import type { AgentInfo, AgentDetail, PromptGenerationRequest, AgentSettings } from '../../src/types';

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// getAgents
// ---------------------------------------------------------------------------

describe('getAgents', () => {
  it('calls GET /api/v1/agents and returns an array of AgentInfo', async () => {
    const agents: AgentInfo[] = [
      {
        id: 'senior-architect',
        name: 'senior-architect.md',
        displayName: 'Senior Architect',
        path: '/home/user/.claude/agents/senior-architect.md',
        sizeBytes: 11400,
      },
    ];

    mockFetch.mockResolvedValue(makeResponse(agents));

    const result = await getAgents();

    expect(result).toEqual(agents);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agents',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
    // No method override means GET
    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    expect(callArgs.method).toBeUndefined();
  });

  it('returns empty array when server returns []', async () => {
    mockFetch.mockResolvedValue(makeResponse([]));
    const result = await getAgents();
    expect(result).toEqual([]);
  });

  it('throws Error with server message on HTTP error', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'AGENT_DIRECTORY_READ_ERROR', message: 'Could not read the agents directory.' } },
        500
      )
    );
    await expect(getAgents()).rejects.toThrow('Could not read the agents directory.');
  });
});

// ---------------------------------------------------------------------------
// getAgent
// ---------------------------------------------------------------------------

describe('getAgent', () => {
  it('calls GET /api/v1/agents/:agentId with correct path', async () => {
    const detail: AgentDetail = {
      id: 'developer-agent',
      name: 'developer-agent.md',
      displayName: 'Developer Agent',
      path: '/home/user/.claude/agents/developer-agent.md',
      sizeBytes: 6300,
      content: '# Developer Agent\n\nYou are the Developer...',
    };

    mockFetch.mockResolvedValue(makeResponse(detail));

    const result = await getAgent('developer-agent');

    expect(result).toEqual(detail);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agents/developer-agent',
      expect.any(Object)
    );
  });

  it('URL-encodes the agentId', async () => {
    mockFetch.mockResolvedValue(makeResponse({}));
    await getAgent('my agent').catch(() => {});
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agents/my%20agent',
      expect.any(Object)
    );
  });

  it('throws Error with AGENT_NOT_FOUND message on 404', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'AGENT_NOT_FOUND', message: "No agent named 'bad-id' was found." } },
        404
      )
    );
    await expect(getAgent('bad-id')).rejects.toThrow("No agent named 'bad-id' was found.");
  });

  it('throws Error with INVALID_AGENT_ID message on 400', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'INVALID_AGENT_ID', message: 'The agent ID provided is not valid.' } },
        400
      )
    );
    await expect(getAgent('../etc/passwd')).rejects.toThrow('The agent ID provided is not valid.');
  });
});

// ---------------------------------------------------------------------------
// generatePrompt
// ---------------------------------------------------------------------------

describe('generatePrompt', () => {
  const request: PromptGenerationRequest = {
    agentId: 'senior-architect',
    taskId: 'task-abc-123',
    spaceId: 'space-xyz-456',
    customInstructions: 'Focus on scalability.',
    workingDirectory: '/Users/oscar/project',
  };

  const response = {
    promptPath: '/abs/path/to/prompt-1234-abc.md',
    promptPreview: '## TASK CONTEXT\nTitle: My Task\n...',
    cliCommand: 'claude -p "$(cat /abs/path/to/prompt-1234-abc.md)" --allowedTools "Agent,Bash,Read,Write,Edit,Glob,Grep"',
    estimatedTokens: 1800,
  };

  it('calls POST /api/v1/agent/prompt with the request body', async () => {
    mockFetch.mockResolvedValue(makeResponse(response, 201));

    const result = await generatePrompt(request);

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agent/prompt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
      })
    );
  });

  it('includes only required fields when optional ones are omitted', async () => {
    const minimalRequest: PromptGenerationRequest = {
      agentId: 'developer-agent',
      taskId: 'task-1',
      spaceId: 'space-1',
    };

    mockFetch.mockResolvedValue(makeResponse(response, 201));
    await generatePrompt(minimalRequest);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/agent/prompt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(minimalRequest),
      })
    );
  });

  it('returns promptPath, promptPreview, cliCommand, estimatedTokens', async () => {
    mockFetch.mockResolvedValue(makeResponse(response, 201));
    const result = await generatePrompt(request);
    expect(result.promptPath).toBe(response.promptPath);
    expect(result.promptPreview).toBe(response.promptPreview);
    expect(result.cliCommand).toBe(response.cliCommand);
    expect(result.estimatedTokens).toBe(1800);
  });

  it('throws on 400 VALIDATION_ERROR', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'VALIDATION_ERROR', message: "The 'agentId' field is required." } },
        400
      )
    );
    await expect(generatePrompt(request)).rejects.toThrow("The 'agentId' field is required.");
  });

  it('throws on 404 TASK_NOT_FOUND', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'TASK_NOT_FOUND', message: "Task 'task-abc-123' was not found in space 'space-xyz-456'." } },
        404
      )
    );
    await expect(generatePrompt(request)).rejects.toThrow("Task 'task-abc-123' was not found in space 'space-xyz-456'.");
  });

  it('throws on 500 PROMPT_WRITE_ERROR', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'PROMPT_WRITE_ERROR', message: 'Could not write the prompt file to disk.' } },
        500
      )
    );
    await expect(generatePrompt(request)).rejects.toThrow('Could not write the prompt file to disk.');
  });
});

// ---------------------------------------------------------------------------
// getSettings
// ---------------------------------------------------------------------------

describe('getSettings', () => {
  const defaultSettings: AgentSettings = {
    cli: {
      tool: 'claude',
      binary: 'claude',
      flags: ['-p'],
      promptFlag: '-p',
      fileInputMethod: 'cat-subshell',
    },
    pipeline: {
      autoAdvance: true,
      confirmBetweenStages: true,
      stages: ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'],
    },
    prompts: {
      includeKanbanBlock: true,
      includeGitBlock: true,
      workingDirectory: '',
    },
  };

  it('calls GET /api/v1/settings and returns the settings object', async () => {
    mockFetch.mockResolvedValue(makeResponse(defaultSettings));

    const result = await getSettings();

    expect(result).toEqual(defaultSettings);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/settings',
      expect.any(Object)
    );
    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    expect(callArgs.method).toBeUndefined(); // GET (no method override)
  });

  it('returns settings with cli.tool, pipeline.stages, and prompts fields', async () => {
    mockFetch.mockResolvedValue(makeResponse(defaultSettings));
    const result = await getSettings();
    expect(result.cli.tool).toBe('claude');
    expect(result.pipeline.stages).toHaveLength(4);
    expect(result.prompts.includeKanbanBlock).toBe(true);
  });

  it('throws on 500 SETTINGS_READ_ERROR', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'SETTINGS_READ_ERROR', message: 'Could not read the settings file.' } },
        500
      )
    );
    await expect(getSettings()).rejects.toThrow('Could not read the settings file.');
  });
});

// ---------------------------------------------------------------------------
// saveSettings
// ---------------------------------------------------------------------------

describe('saveSettings', () => {
  const updatedSettings: AgentSettings = {
    cli: {
      tool: 'opencode',
      binary: 'opencode',
      flags: [],
      promptFlag: '-p',
      fileInputMethod: 'cat-subshell',
    },
    pipeline: {
      autoAdvance: false,
      confirmBetweenStages: true,
      stages: ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'],
    },
    prompts: {
      includeKanbanBlock: true,
      includeGitBlock: false,
      workingDirectory: '/Users/oscar/project',
    },
  };

  it('calls PUT /api/v1/settings with the partial settings body', async () => {
    const partial: Partial<AgentSettings> = { cli: { tool: 'opencode', binary: 'opencode', flags: [], promptFlag: '-p', fileInputMethod: 'cat-subshell' } };

    mockFetch.mockResolvedValue(makeResponse(updatedSettings));

    const result = await saveSettings(partial);

    expect(result).toEqual(updatedSettings);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/settings',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(partial),
      })
    );
  });

  it('returns the full merged settings from server response', async () => {
    mockFetch.mockResolvedValue(makeResponse(updatedSettings));
    const result = await saveSettings({ cli: { tool: 'opencode', binary: 'opencode', flags: [], promptFlag: '-p', fileInputMethod: 'cat-subshell' } });
    expect(result.cli.tool).toBe('opencode');
    expect(result.pipeline.stages).toHaveLength(4);
  });

  it('throws on 400 VALIDATION_ERROR for invalid tool', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'VALIDATION_ERROR', message: "The value 'mycli' is not a valid CLI tool." } },
        400
      )
    );
    await expect(saveSettings({ cli: { tool: 'custom', binary: 'mycli', flags: [], promptFlag: '-p', fileInputMethod: 'cat-subshell' } })).rejects.toThrow(
      "The value 'mycli' is not a valid CLI tool."
    );
  });

  it('throws on 400 VALIDATION_ERROR for empty body', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'VALIDATION_ERROR', message: 'The request body is empty or not valid JSON.' } },
        400
      )
    );
    await expect(saveSettings({})).rejects.toThrow('The request body is empty or not valid JSON.');
  });

  it('throws on 500 SETTINGS_WRITE_ERROR', async () => {
    mockFetch.mockResolvedValue(
      makeResponse(
        { error: { code: 'SETTINGS_WRITE_ERROR', message: 'Could not save the settings file.' } },
        500
      )
    );
    await expect(saveSettings({ prompts: { includeKanbanBlock: false, includeGitBlock: true, workingDirectory: '' } })).rejects.toThrow(
      'Could not save the settings file.'
    );
  });
});
