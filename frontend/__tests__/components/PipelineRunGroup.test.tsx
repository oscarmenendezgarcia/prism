/**
 * Tests for PipelineRunGroup component.
 * ADR-1 (pipeline-run-history-bridge) T-008.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineRunGroup } from '../../src/components/agent-run-history/PipelineRunGroup';
import type { AgentRunRecord } from '../../src/types';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _c = 0;
function makeStage(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  _c++;
  return {
    id:               `stage_${_c}`,
    taskId:           'task-001',
    taskTitle:        'My Pipeline Task',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer Agent',
    spaceId:          'space-1',
    spaceName:        'Prism',
    status:           'completed',
    startedAt:        new Date(Date.now() - _c * 60000).toISOString(),
    completedAt:      new Date().toISOString(),
    durationMs:       5000,
    cliCommand:       '',
    promptPath:       '',
    pipelineRunId:    'pipeline-1',
    stageIndex:       _c - 1,
    ...overrides,
  };
}

function makeStages(count: number, overrides: Partial<AgentRunRecord>[] = []): AgentRunRecord[] {
  _c = 0;
  return Array.from({ length: count }, (_, i) => makeStage(overrides[i] ?? {}));
}

// ---------------------------------------------------------------------------
// Rendering tests
// ---------------------------------------------------------------------------

describe('PipelineRunGroup — structure', () => {
  it('renders the group header button with aria-expanded', () => {
    const stages = makeStages(2);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="completed"
      />
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-expanded');
  });

  it('renders task title from first stage', () => {
    const stages = makeStages(2);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="completed"
      />
    );
    expect(screen.getByText('My Pipeline Task')).toBeInTheDocument();
  });

  it('renders space name from first stage', () => {
    const stages = makeStages(2);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="completed"
      />
    );
    expect(screen.getAllByText('Prism').length).toBeGreaterThan(0);
  });

  it('renders stage count badge', () => {
    const stages = makeStages(3);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="completed"
      />
    );
    expect(screen.getByText(/3 stages/)).toBeInTheDocument();
  });

  it('shows progress badge when a stage is running', () => {
    _c = 0;
    const stages = makeStages(3, [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'running', completedAt: null, durationMs: null },
    ]);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="running"
      />
    );
    expect(screen.getByText(/2\/3 stages/)).toBeInTheDocument();
  });
});

describe('PipelineRunGroup — collapsed / expanded state', () => {
  it('defaults to collapsed when all stages are completed', () => {
    const stages = makeStages(2);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="completed"
      />
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    // Stage entries should NOT be visible when collapsed.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('defaults to expanded when a stage is running', () => {
    _c = 0;
    const stages = makeStages(2, [
      { status: 'running', completedAt: null, durationMs: null },
      { status: 'running', completedAt: null, durationMs: null },
    ]);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="running"
      />
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the header toggles collapsed → expanded', () => {
    const stages = makeStages(2);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="completed"
      />
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    // Nested stage list should be visible.
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('clicking the header toggles expanded → collapsed', () => {
    _c = 0;
    const stages = makeStages(2, [
      { status: 'running', completedAt: null, durationMs: null },
      {},
    ]);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="running"
      />
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('PipelineRunGroup — expanded stage list', () => {
  it('renders one RunHistoryEntry per stage when expanded', () => {
    _c = 0;
    const stages = makeStages(3, [
      { agentDisplayName: 'Senior Architect' },
      { agentDisplayName: 'Developer Agent' },
      { agentDisplayName: 'QA Engineer E2E' },
    ]);
    render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="completed"
      />
    );
    // Expand.
    fireEvent.click(screen.getByRole('button'));
    // Each stage label prefix should appear.
    expect(screen.getByText(/Stage 1: Senior Architect/)).toBeInTheDocument();
    expect(screen.getByText(/Stage 2: Developer Agent/)).toBeInTheDocument();
    expect(screen.getByText(/Stage 3: QA Engineer E2E/)).toBeInTheDocument();
  });
});

describe('PipelineRunGroup — aggregate status icon classes', () => {
  it('applies border-l-success for completed aggregateStatus', () => {
    const stages = makeStages(2);
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="completed"
      />
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('border-l-success');
  });

  it('applies border-l-primary for running aggregateStatus', () => {
    _c = 0;
    const stages = makeStages(2, [
      { status: 'running', completedAt: null, durationMs: null },
      { status: 'running', completedAt: null, durationMs: null },
    ]);
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="running"
      />
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('border-l-primary');
  });

  it('applies border-l-error for failed aggregateStatus', () => {
    _c = 0;
    const stages = makeStages(2, [
      { status: 'failed' },
      { status: 'completed' },
    ]);
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipeline-1"
        stages={stages}
        aggregateStatus="failed"
      />
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('border-l-error');
  });
});
