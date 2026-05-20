/**
 * Component tests for PipelineRunGroup.
 * T-005 acceptance criteria:
 *  - Click on main header area invokes onOpenLogs(0)
 *  - Click on chevron only toggles expand/collapse, does NOT invoke onOpenLogs
 *  - Click on internal stage row invokes onOpenLogs with that stageIndex
 *  - aria-expanded is on the chevron
 *  - Without onOpenLogs: no interactive affordances on main area
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AgentRunRecord, RunStatus } from '@/types';
import { PipelineRunGroup } from '../PipelineRunGroup';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStage(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id:               'run-1',
    taskId:           'task-1',
    taskTitle:        'feat: pipeline test',
    agentId:          'senior-architect',
    agentDisplayName: 'Senior Architect',
    spaceId:          'space-1',
    spaceName:        'My Space',
    status:           'completed',
    startedAt:        '2026-05-18T10:00:00.000Z',
    completedAt:      '2026-05-18T10:05:00.000Z',
    durationMs:       300000,
    cliCommand:       'claude',
    promptPath:       '/tmp/p.md',
    pipelineRunId:    'pipe-1',
    stageIndex:       0,
    ...overrides,
  };
}

const STAGES: AgentRunRecord[] = [
  makeStage({ id: 'r0', agentId: 'senior-architect', stageIndex: 0 }),
  makeStage({ id: 'r1', agentId: 'developer-agent',  stageIndex: 1 }),
];

const AGGREGATE_STATUS: RunStatus = 'completed';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineRunGroup — without onOpenLogs', () => {
  it('renders task title', () => {
    render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
      />
    );
    expect(screen.getByText('feat: pipeline test')).toBeDefined();
  });

  it('main area does NOT have role="button" when onOpenLogs absent', () => {
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
      />
    );
    const mainArea = container.querySelector('[role="button"]');
    expect(mainArea).toBeNull();
  });

  it('chevron button is always present', () => {
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
      />
    );
    // Exactly one <button> element (the chevron) when no onOpenLogs
    const buttons = container.querySelectorAll('button[type="button"]');
    expect(buttons.length).toBe(1);
  });
});

describe('PipelineRunGroup — with onOpenLogs', () => {
  it('main area has role="button" when onOpenLogs provided', () => {
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
        onOpenLogs={vi.fn()}
      />
    );
    const mainArea = container.querySelector('[role="button"]');
    expect(mainArea).not.toBeNull();
  });

  it('clicking main area invokes onOpenLogs(0)', () => {
    const handler = vi.fn();
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
        onOpenLogs={handler}
      />
    );
    const mainArea = container.querySelector('[role="button"]')!;
    fireEvent.click(mainArea);
    expect(handler).toHaveBeenCalledWith(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('pressing Enter on main area invokes onOpenLogs(0)', () => {
    const handler = vi.fn();
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
        onOpenLogs={handler}
      />
    );
    const mainArea = container.querySelector('[role="button"]')!;
    fireEvent.keyDown(mainArea, { key: 'Enter' });
    expect(handler).toHaveBeenCalledWith(0);
  });

  it('pressing Space on main area invokes onOpenLogs(0)', () => {
    const handler = vi.fn();
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
        onOpenLogs={handler}
      />
    );
    const mainArea = container.querySelector('[role="button"]')!;
    fireEvent.keyDown(mainArea, { key: ' ' });
    expect(handler).toHaveBeenCalledWith(0);
  });

  it('chevron click does NOT invoke onOpenLogs', () => {
    const handler = vi.fn();
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
        onOpenLogs={handler}
      />
    );
    // Chevron is the only <button type="button"> — main area is a div[role="button"]
    const chevron = container.querySelector('button[type="button"]')!;
    fireEvent.click(chevron);
    expect(handler).not.toHaveBeenCalled();
  });

  it('chevron click toggles expand/collapse', () => {
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
        onOpenLogs={vi.fn()}
      />
    );
    const chevron = container.querySelector('button[type="button"]')!;
    // Initial state: collapsed (both stages completed, no running)
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chevron);
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(chevron);
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
  });

  it('aria-expanded lives on the chevron button', () => {
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
        onOpenLogs={vi.fn()}
      />
    );
    const chevron = container.querySelector('button[type="button"]')!;
    expect(chevron.hasAttribute('aria-expanded')).toBe(true);
  });
});

describe('PipelineRunGroup — expanded stage rows', () => {
  it('each expanded stage row opens logs with that stageIndex', () => {
    const handler = vi.fn();
    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={STAGES}
        aggregateStatus={AGGREGATE_STATUS}
        onOpenLogs={handler}
      />
    );

    // Expand the group via the chevron
    const chevron = container.querySelector('button[type="button"]')!;
    fireEvent.click(chevron);

    // Stage rows are <li role="button"> elements (RunHistoryEntry with onClick)
    const liButtons = container.querySelectorAll('li[role="button"]');
    expect(liButtons.length).toBe(2); // 2 stages

    // Click the second stage row (stage index 1)
    fireEvent.click(liButtons[1]);
    expect(handler).toHaveBeenCalledWith(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('PipelineRunGroup — running stage auto-expands', () => {
  it('is expanded by default when a stage is running', () => {
    const runningStages = [
      makeStage({ id: 'r0', status: 'completed', stageIndex: 0 }),
      makeStage({ id: 'r1', status: 'running',   stageIndex: 1, completedAt: null, durationMs: null }),
    ];

    const { container } = render(
      <PipelineRunGroup
        pipelineRunId="pipe-1"
        stages={runningStages}
        aggregateStatus="running"
        onOpenLogs={vi.fn()}
      />
    );

    const chevron = container.querySelector('button[type="button"]')!;
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
  });
});
