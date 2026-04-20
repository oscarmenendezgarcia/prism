/**
 * Tests for RunHistoryEntry component.
 * ADR-1 (Agent Run History) T-014.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunHistoryEntry } from '../../src/components/agent-run-history/RunHistoryEntry';
import type { AgentRunRecord } from '../../src/types';

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id:               'run_100_test',
    taskId:           'task-001',
    taskTitle:        'Implement feature X',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer Agent',
    spaceId:          'space-1',
    spaceName:        'Prism',
    status:           'running',
    startedAt:        new Date(Date.now() - 60000).toISOString(), // 1 min ago
    completedAt:      null,
    durationMs:       null,
    cliCommand:       'claude ...',
    promptPath:       '/tmp/prompt.md',
    ...overrides,
  };
}

describe('RunHistoryEntry — rendering', () => {
  it('renders agent display name', () => {
    render(<RunHistoryEntry run={makeRun()} />);
    expect(screen.getByText('Developer Agent')).toBeInTheDocument();
  });

  it('renders task title', () => {
    render(<RunHistoryEntry run={makeRun()} />);
    expect(screen.getByText('Implement feature X')).toBeInTheDocument();
  });

  it('renders relative time', () => {
    render(<RunHistoryEntry run={makeRun()} />);
    // 1 min ago should render "1 min ago"
    expect(screen.getByText(/min ago/)).toBeInTheDocument();
  });
});

describe('RunHistoryEntry — status dot', () => {
  it('shows pulsing dot with bg-primary for running status', () => {
    const { container } = render(<RunHistoryEntry run={makeRun({ status: 'running' })} />);
    const dot = container.querySelector('span[aria-label="running"]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('bg-primary');
  });

  it('shows dot with bg-success for completed status', () => {
    const { container } = render(<RunHistoryEntry run={makeRun({ status: 'completed', completedAt: new Date().toISOString(), durationMs: 5000 })} />);
    const dot = container.querySelector('span[aria-label="completed"]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('bg-success');
  });

  it('shows dot with bg-warning for cancelled status', () => {
    const { container } = render(<RunHistoryEntry run={makeRun({ status: 'cancelled', completedAt: new Date().toISOString(), durationMs: 2000 })} />);
    const dot = container.querySelector('span[aria-label="cancelled"]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('bg-warning');
  });

  it('shows dot with bg-error for failed status', () => {
    const { container } = render(<RunHistoryEntry run={makeRun({ status: 'failed', completedAt: new Date().toISOString(), durationMs: 1000 })} />);
    const dot = container.querySelector('span[aria-label="failed"]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('bg-error');
  });
});

describe('RunHistoryEntry — hover style', () => {
  it('applies hover:bg-surface-variant for clickable appearance', () => {
    const { container } = render(<RunHistoryEntry run={makeRun({ status: 'running' })} />);
    const li = container.querySelector('li');
    expect(li?.className).toContain('hover:bg-surface-variant');
  });
});

describe('RunHistoryEntry — duration', () => {
  it('does NOT show duration when completedAt is null', () => {
    render(<RunHistoryEntry run={makeRun({ completedAt: null, durationMs: null })} />);
    // Duration should not appear
    expect(screen.queryByLabelText(/Duration/)).not.toBeInTheDocument();
  });

  it('shows formatted duration when durationMs is set', () => {
    render(<RunHistoryEntry run={makeRun({
      status:      'completed',
      completedAt: new Date().toISOString(),
      durationMs:  323000, // 5:23
    })} />);
    expect(screen.getByLabelText(/Duration/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Duration/).textContent).toBe('5:23');
  });

  it('formats 65 seconds as 1:05', () => {
    render(<RunHistoryEntry run={makeRun({
      status:      'completed',
      completedAt: new Date().toISOString(),
      durationMs:  65000,
    })} />);
    expect(screen.getByText('1:05')).toBeInTheDocument();
  });
});

describe('RunHistoryEntry — stageLabel prop', () => {
  it('renders agent name alone when stageLabel is not provided', () => {
    render(<RunHistoryEntry run={makeRun()} />);
    expect(screen.getByText('Developer Agent')).toBeInTheDocument();
  });

  it('prepends stageLabel to agent display name when provided', () => {
    render(<RunHistoryEntry run={makeRun()} stageLabel="Stage 1" />);
    expect(screen.getByText('Stage 1: Developer Agent')).toBeInTheDocument();
  });

  it('handles multi-word stage labels correctly', () => {
    render(<RunHistoryEntry run={makeRun({ agentDisplayName: 'Senior Architect' })} stageLabel="Stage 2" />);
    expect(screen.getByText('Stage 2: Senior Architect')).toBeInTheDocument();
  });
});
