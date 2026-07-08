/**
 * Tests for StructuredLogView and event row components.
 * T-003: each PublicEvent kind renders the correct component.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';
import type { PublicEvent, ToolCallEvent } from '../../src/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getStageEvents: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    events:        [],
    nextSince:     0,
    complete:      true,
    stageStatus:   'running',
  }),
  EventsNotAvailableError: class EventsNotAvailableError extends Error {
    constructor() { super('EVENTS_NOT_AVAILABLE'); this.name = 'EventsNotAvailableError'; }
  },
}));

import { StructuredLogView } from '../../src/components/pipeline-log/StructuredLogView';
import { EventRow }          from '../../src/components/pipeline-log/events/EventRow';
import * as apiClient        from '../../src/api/client';
import { SessionStartRow, FinalResultRow } from '../../src/components/pipeline-log/events/SessionMarkerRow';
import { ToolCallRow, ToolResultRow }      from '../../src/components/pipeline-log/events/ToolCallRow';
import { AssistantTextRow }                from '../../src/components/pipeline-log/events/AssistantTextRow';
import { ErrorRow, RateLimitRow }          from '../../src/components/pipeline-log/events/ErrorRow';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  usePipelineLogStore.setState({
    stageEvents:             {},
    stageEventsNextSince:    {},
    stageEventsLoading:      {},
    stageEventsError:        {},
    stageEventsNotAvailable: {},
  } as any);
}

const emptyToolMap = new Map<string, ToolCallEvent>();

// ---------------------------------------------------------------------------
// SessionStartRow
// ---------------------------------------------------------------------------

describe('SessionStartRow', () => {
  it('renders Session Start label', () => {
    const ev: PublicEvent = { idx: 0, kind: 'session_start', t: 0, model: 'claude-opus-4' };
    render(<SessionStartRow event={ev as any} />);
    expect(screen.getByText('Session Start')).toBeTruthy();
    expect(screen.getByText('claude-opus-4')).toBeTruthy();
  });

  it('renders without model gracefully', () => {
    const ev: PublicEvent = { idx: 0, kind: 'session_start', t: 0 };
    render(<SessionStartRow event={ev as any} />);
    expect(screen.getByText('Session Start')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// FinalResultRow
// ---------------------------------------------------------------------------

describe('FinalResultRow', () => {
  it('renders Session Complete with formatted values', () => {
    const ev: PublicEvent = {
      idx: 10, kind: 'final_result', t: 10,
      durationMs: 45200, numTurns: 7, costUsd: 0.0124, stopReason: 'end_turn',
    };
    render(<FinalResultRow event={ev as any} />);
    expect(screen.getByText('Session Complete')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('end_turn')).toBeTruthy();
  });

  it('renders the raw summary instead of the metrics row for plain-text (opencode) stages', () => {
    const ev: PublicEvent = {
      idx: 11, kind: 'final_result', t: 11,
      durationMs: 0, numTurns: 0, costUsd: 0, stopReason: 'unknown',
      summary: 'All 75 tests pass.\nBuild succeeded.',
    };
    render(<FinalResultRow event={ev as any} />);
    expect(screen.getByText('Session Complete')).toBeTruthy();
    expect(screen.getByText(/All 75 tests pass/)).toBeTruthy();
    expect(screen.queryByText('unknown')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ToolCallRow
// ---------------------------------------------------------------------------

describe('ToolCallRow', () => {
  it('renders tool name', () => {
    const ev: PublicEvent = {
      idx: 1, kind: 'tool_call', t: 1,
      id: 'call_abc', name: 'fetch-github', inputPreview: '{"owner":"cli"}',
    };
    render(<ToolCallRow event={ev as any} />);
    expect(screen.getByText('fetch-github')).toBeTruthy();
  });

  it('renders input preview', () => {
    const ev: PublicEvent = {
      idx: 1, kind: 'tool_call', t: 1,
      id: 'call_abc', name: 'read', inputPreview: '{"file_path":"/tmp/test"}',
    };
    render(<ToolCallRow event={ev as any} />);
    expect(screen.getByText('{"file_path":"/tmp/test"}')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ToolResultRow
// ---------------------------------------------------------------------------

describe('ToolResultRow', () => {
  it('renders success result', () => {
    const ev: PublicEvent = {
      idx: 2, kind: 'tool_result', t: 2,
      id: 'call_abc', isError: false, bytes: 2145,
    };
    render(<ToolResultRow event={ev as any} />);
    expect(screen.getByText('OK')).toBeTruthy();
    expect(screen.getByText(/2\.1 KB/)).toBeTruthy();
  });

  it('renders error result with error styling', () => {
    const ev: PublicEvent = {
      idx: 3, kind: 'tool_result', t: 3,
      id: 'call_abc', isError: true, bytes: 0,
    };
    const { container } = render(<ToolResultRow event={ev as any} />);
    expect(screen.getByText('ERROR')).toBeTruthy();
    expect(container.firstChild).toHaveClass('bg-error/10');
  });

  it('shows tool name when provided', () => {
    const ev: PublicEvent = {
      idx: 2, kind: 'tool_result', t: 2,
      id: 'call_abc', isError: false, bytes: 100,
    };
    render(<ToolResultRow event={ev as any} toolName="bash" />);
    expect(screen.getByText(/from bash/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AssistantTextRow
// ---------------------------------------------------------------------------

describe('AssistantTextRow', () => {
  it('renders assistant text preview collapsed by default', () => {
    const ev: PublicEvent = {
      idx: 4, kind: 'assistant_text', t: 4,
      bytes: 50, preview: 'This is a test message from the assistant.',
    };
    render(<AssistantTextRow event={ev as any} />);
    expect(screen.getByText('Assistant')).toBeTruthy();
    expect(screen.getByText('This is a test message from the assistant.')).toBeTruthy();
  });

  it('expands on button click when truncated', () => {
    const longPreview = 'A'.repeat(1200);
    const ev: PublicEvent = {
      idx: 5, kind: 'assistant_text', t: 5,
      bytes: 1500, preview: longPreview,
    };
    render(<AssistantTextRow event={ev as any} />);
    const btn = screen.getByText('Show more');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.getByText('Show less')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ErrorRow
// ---------------------------------------------------------------------------

describe('ErrorRow', () => {
  it('renders error message with error styling', () => {
    const ev: PublicEvent = {
      idx: 6, kind: 'error', t: 6,
      tool: 'bash', message: 'Command failed with exit code 1',
    };
    const { container } = render(<ErrorRow event={ev as any} />);
    expect(screen.getByText('ERROR')).toBeTruthy();
    expect(screen.getByText('Command failed with exit code 1')).toBeTruthy();
    expect(screen.getByText('bash')).toBeTruthy();
    expect(container.firstChild).toHaveClass('bg-error/10');
    expect(container.firstChild).toHaveClass('border-l-error');
  });

  it('renders without tool field', () => {
    const ev: PublicEvent = {
      idx: 7, kind: 'error', t: 7,
      message: 'Unexpected error occurred',
    };
    render(<ErrorRow event={ev as any} />);
    expect(screen.getByText('Unexpected error occurred')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// RateLimitRow
// ---------------------------------------------------------------------------

describe('RateLimitRow', () => {
  it('renders rate limit status', () => {
    const ev: PublicEvent = {
      idx: 8, kind: 'rate_limit', t: 8,
      status: '429 Too Many Requests',
    };
    render(<RateLimitRow event={ev as any} />);
    expect(screen.getByText('Rate Limit')).toBeTruthy();
    expect(screen.getByText('429 Too Many Requests')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// EventRow dispatcher
// ---------------------------------------------------------------------------

describe('EventRow dispatcher', () => {
  const toolMap = new Map<string, ToolCallEvent>();

  it('dispatches session_start to SessionStartRow', () => {
    const ev: PublicEvent = { idx: 0, kind: 'session_start', t: 0 };
    render(<EventRow event={ev} toolMap={toolMap} />);
    expect(screen.getByText('Session Start')).toBeTruthy();
  });

  it('dispatches tool_call to ToolCallRow', () => {
    const ev: PublicEvent = {
      idx: 1, kind: 'tool_call', t: 1,
      id: 'c1', name: 'grep', inputPreview: '{}',
    };
    render(<EventRow event={ev} toolMap={toolMap} />);
    expect(screen.getByText('grep')).toBeTruthy();
  });

  it('dispatches assistant_text to AssistantTextRow', () => {
    const ev: PublicEvent = {
      idx: 2, kind: 'assistant_text', t: 2,
      bytes: 20, preview: 'Hello assistant',
    };
    render(<EventRow event={ev} toolMap={toolMap} />);
    expect(screen.getByText('Assistant')).toBeTruthy();
  });

  it('dispatches error to ErrorRow', () => {
    const ev: PublicEvent = {
      idx: 3, kind: 'error', t: 3,
      message: 'boom',
    };
    render(<EventRow event={ev} toolMap={toolMap} />);
    expect(screen.getByText('ERROR')).toBeTruthy();
  });

  it('dispatches rate_limit to RateLimitRow', () => {
    const ev: PublicEvent = {
      idx: 4, kind: 'rate_limit', t: 4,
      status: '429',
    };
    render(<EventRow event={ev} toolMap={toolMap} />);
    expect(screen.getByText('Rate Limit')).toBeTruthy();
  });

  it('dispatches final_result to FinalResultRow', () => {
    const ev: PublicEvent = {
      idx: 5, kind: 'final_result', t: 5,
      durationMs: 1000, numTurns: 2, costUsd: 0.001, stopReason: 'end_turn',
    };
    render(<EventRow event={ev} toolMap={toolMap} />);
    expect(screen.getByText('Session Complete')).toBeTruthy();
  });

  it('pairs tool_result with tool_call for duration computation', () => {
    const call: ToolCallEvent = { idx: 0, kind: 'tool_call', t: 10, id: 'c1', name: 'bash', inputPreview: '' };
    const map = new Map<string, ToolCallEvent>([['c1', call]]);
    const result: PublicEvent = { idx: 1, kind: 'tool_result', t: 15, id: 'c1', isError: false, bytes: 100 };
    render(<EventRow event={result} toolMap={map} />);
    // Duration = (15 - 10) * 1000ms = 5000ms = 5.00 s
    expect(screen.getByText(/5\.00 s/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// StructuredLogView — empty + loading states
// ---------------------------------------------------------------------------

describe('StructuredLogView — states', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('renders pending empty state when isPending and no events', async () => {
    usePipelineLogStore.setState({
      stageEvents:             { 0: [] },
      stageEventsLoading:      { 0: false },
      stageEventsError:        { 0: null },
      stageEventsNotAvailable: { 0: false },
      stageEventsNextSince:    { 0: 0 },
    } as any);

    await act(async () => {
      render(
        <StructuredLogView
          runId="run-1"
          stageIndex={0}
          storeKey={0}
          isRunning={false}
          isPending={true}
        />
      );
    });
    expect(screen.getByText('Stage has not started.')).toBeTruthy();
  });

  it('renders running empty state when running and no events', async () => {
    usePipelineLogStore.setState({
      stageEvents:             { 0: [] },
      stageEventsLoading:      { 0: false },
      stageEventsError:        { 0: null },
      stageEventsNotAvailable: { 0: false },
      stageEventsNextSince:    { 0: 0 },
    } as any);

    await act(async () => {
      render(
        <StructuredLogView
          runId="run-1"
          stageIndex={0}
          storeKey={0}
          isRunning={true}
          isPending={false}
        />
      );
    });
    expect(screen.getByText('No events yet.')).toBeTruthy();
  });

  it('renders error state with retry button', async () => {
    // fetchEvents runs on mount and clears any pre-set error before re-setting it.
    // Make getStageEvents reject so the component sets the error state itself.
    vi.mocked(apiClient.getStageEvents).mockRejectedValueOnce(new Error('Network error'));

    usePipelineLogStore.setState({
      stageEvents:             { 0: [] },
      stageEventsLoading:      { 0: false },
      stageEventsError:        { 0: null },
      stageEventsNotAvailable: { 0: false },
      stageEventsNextSince:    { 0: 0 },
    } as any);

    await act(async () => {
      render(
        <StructuredLogView
          runId="run-1"
          stageIndex={0}
          storeKey={0}
          isRunning={false}
          isPending={false}
        />
      );
    });
    expect(screen.getByText('Unable to load events.')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('does not fire a second fetch while one is already in-flight (polling race guard)', async () => {
    // Simulate: stageEventsLoading[0] = true when the component mounts.
    // fetchEvents should bail out immediately and NOT call getStageEvents.
    usePipelineLogStore.setState({
      stageEvents:             { 0: [] },
      stageEventsLoading:      { 0: true }, // already in-flight
      stageEventsError:        { 0: null },
      stageEventsNotAvailable: { 0: false },
      stageEventsNextSince:    { 0: 0 },
    } as any);

    vi.mocked(apiClient.getStageEvents).mockClear();

    await act(async () => {
      render(
        <StructuredLogView
          runId="run-1"
          stageIndex={0}
          storeKey={0}
          isRunning={true}
          isPending={false}
        />
      );
    });

    // getStageEvents must not have been called — the guard blocked it.
    expect(vi.mocked(apiClient.getStageEvents)).not.toHaveBeenCalled();
  });

  it('renders events when present', async () => {
    usePipelineLogStore.setState({
      stageEvents: {
        0: [
          { idx: 0, kind: 'session_start', t: 0, model: 'claude-opus-4' },
          { idx: 1, kind: 'tool_call', t: 1, id: 'c1', name: 'grep', inputPreview: '{}' },
        ],
      },
      stageEventsLoading:      { 0: false },
      stageEventsError:        { 0: null },
      stageEventsNotAvailable: { 0: false },
      stageEventsNextSince:    { 0: 2 },
    } as any);

    await act(async () => {
      render(
        <StructuredLogView
          runId="run-1"
          stageIndex={0}
          storeKey={0}
          isRunning={false}
          isPending={false}
        />
      );
    });
    expect(screen.getByText('Session Start')).toBeTruthy();
    expect(screen.getByText('grep')).toBeTruthy();
  });
});
