/**
 * Component tests for RunHistoryEntry.
 * T-004 acceptance criteria: onClick, keyboard (Enter/Space), aria-label, no-onClick fallback.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AgentRunRecord } from '@/types';
import { RunHistoryEntry } from '../RunHistoryEntry';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id:               'run-test-1',
    taskId:           'task-1',
    taskTitle:        'feat: test feature',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer',
    spaceId:          'space-1',
    spaceName:        'My Space',
    status:           'completed',
    startedAt:        new Date(Date.now() - 120000).toISOString(),
    completedAt:      new Date().toISOString(),
    durationMs:       120000,
    cliCommand:       'claude',
    promptPath:       '/tmp/prompt.md',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: without onClick (default/no-interaction mode)
// ---------------------------------------------------------------------------

describe('RunHistoryEntry — without onClick', () => {
  it('renders agent display name and task title', () => {
    render(<RunHistoryEntry run={makeRun()} />);

    expect(screen.getByText('Developer')).toBeDefined();
    expect(screen.getByText('feat: test feature')).toBeDefined();
  });

  it('does NOT have role="button" when onClick is absent', () => {
    const { container } = render(<RunHistoryEntry run={makeRun()} />);
    const li = container.querySelector('li');
    expect(li?.getAttribute('role')).toBeNull();
  });

  it('does NOT have tabIndex when onClick is absent', () => {
    const { container } = render(<RunHistoryEntry run={makeRun()} />);
    const li = container.querySelector('li');
    expect(li?.getAttribute('tabindex')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: with onClick (interactive mode)
// ---------------------------------------------------------------------------

describe('RunHistoryEntry — with onClick', () => {
  it('has role="button" when onClick is provided', () => {
    const { container } = render(<RunHistoryEntry run={makeRun()} onClick={() => {}} />);
    const li = container.querySelector('li');
    expect(li?.getAttribute('role')).toBe('button');
  });

  it('has tabIndex={0} when onClick is provided', () => {
    const { container } = render(<RunHistoryEntry run={makeRun()} onClick={() => {}} />);
    const li = container.querySelector('li');
    expect(li?.getAttribute('tabindex')).toBe('0');
  });

  it('has a meaningful aria-label', () => {
    const run = makeRun({ agentDisplayName: 'Senior Architect', taskTitle: 'feat: arch' });
    const { container } = render(<RunHistoryEntry run={run} onClick={() => {}} />);
    const li = container.querySelector('li');
    expect(li?.getAttribute('aria-label')).toBe('Open logs for Senior Architect — feat: arch');
  });

  it('invokes onClick on click', () => {
    const handler = vi.fn();
    const { container } = render(<RunHistoryEntry run={makeRun()} onClick={handler} />);
    const li = container.querySelector('li')!;
    fireEvent.click(li);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('invokes onClick on Enter key', () => {
    const handler = vi.fn();
    const { container } = render(<RunHistoryEntry run={makeRun()} onClick={handler} />);
    const li = container.querySelector('li')!;
    fireEvent.keyDown(li, { key: 'Enter' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('invokes onClick on Space key', () => {
    const handler = vi.fn();
    const { container } = render(<RunHistoryEntry run={makeRun()} onClick={handler} />);
    const li = container.querySelector('li')!;
    fireEvent.keyDown(li, { key: ' ' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke onClick on other keys', () => {
    const handler = vi.fn();
    const { container } = render(<RunHistoryEntry run={makeRun()} onClick={handler} />);
    const li = container.querySelector('li')!;
    fireEvent.keyDown(li, { key: 'Tab' });
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: stageLabel prop
// ---------------------------------------------------------------------------

describe('RunHistoryEntry — stageLabel', () => {
  it('prepends stageLabel to agent display name', () => {
    render(
      <RunHistoryEntry
        run={makeRun({ agentDisplayName: 'Developer' })}
        stageLabel="Stage 2"
      />
    );
    expect(screen.getByText('Stage 2: Developer')).toBeDefined();
  });
});
