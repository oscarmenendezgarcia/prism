/**
 * Unit tests for StageTabBar component.
 * ADR-1 (log-viewer) T-010: tab rendering, active styling, status icons, onSelect callback.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StageTabBar } from '../../src/components/pipeline-log/StageTabBar';
import type { StageStatus } from '../../src/components/pipeline-log/StageTabBar';

const stages = ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'];

function makeStatus(index: number, status: StageStatus['status']): StageStatus {
  return {
    index,
    agentId:    stages[index],
    status,
    startedAt:  null,
    finishedAt: null,
    exitCode:   null,
  };
}

function allPendingStatuses(): StageStatus[] {
  return stages.map((_, i) => makeStatus(i, 'pending'));
}

describe('StageTabBar — tab rendering', () => {
  it('renders one button per stage', () => {
    render(
      <StageTabBar
        stages={stages}
        stageStatuses={allPendingStatuses()}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
  });

  it('renders short label for senior-architect as "Architect"', () => {
    render(
      <StageTabBar
        stages={['senior-architect']}
        stageStatuses={[makeStatus(0, 'pending')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('Architect')).toBeInTheDocument();
  });

  it('renders short label for ux-api-designer as "UX"', () => {
    render(
      <StageTabBar
        stages={['ux-api-designer']}
        stageStatuses={[makeStatus(0, 'pending')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('UX')).toBeInTheDocument();
  });

  it('renders short label for developer-agent as "Dev"', () => {
    render(
      <StageTabBar
        stages={['developer-agent']}
        stageStatuses={[makeStatus(0, 'pending')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('Dev')).toBeInTheDocument();
  });

  it('renders short label for qa-engineer-e2e as "QA"', () => {
    render(
      <StageTabBar
        stages={['qa-engineer-e2e']}
        stageStatuses={[makeStatus(0, 'pending')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('QA')).toBeInTheDocument();
  });

  it('falls back to first word of unknown agent ID', () => {
    render(
      <StageTabBar
        stages={['custom-agent']}
        stageStatuses={[makeStatus(0, 'pending')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('custom')).toBeInTheDocument();
  });
});

describe('StageTabBar — active tab styling', () => {
  it('marks the selected tab with aria-selected=true', () => {
    render(
      <StageTabBar
        stages={stages}
        stageStatuses={allPendingStatuses()}
        selectedIndex={2}
        onSelect={vi.fn()}
      />
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('applies active styling (bg-surface-variant) to the active tab', () => {
    render(
      <StageTabBar
        stages={stages}
        stageStatuses={allPendingStatuses()}
        selectedIndex={1}
        onSelect={vi.fn()}
      />
    );
    const tabs = screen.getAllByRole('tab');
    // Active tab gets bg-surface-variant + agent-specific border color
    expect(tabs[1].className).toContain('bg-surface-variant');
    // ux-api-designer (index 1) uses border-agent-ux
    expect(tabs[1].className).toContain('border-agent-ux');
  });

  it('does not apply active agent border color to inactive tabs', () => {
    render(
      <StageTabBar
        stages={stages}
        stageStatuses={allPendingStatuses()}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    const tabs = screen.getAllByRole('tab');
    // Inactive tabs should not have agent-specific border colors
    expect(tabs[1].className).not.toContain('border-agent-ux');
    expect(tabs[2].className).not.toContain('border-agent-dev');
  });
});

describe('StageTabBar — onSelect callback', () => {
  it('calls onSelect with the correct index when clicking a tab', () => {
    const onSelect = vi.fn();
    render(
      <StageTabBar
        stages={stages}
        stageStatuses={allPendingStatuses()}
        selectedIndex={0}
        onSelect={onSelect}
      />
    );
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[3]);
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('calls onSelect with index 0 when clicking first tab', () => {
    const onSelect = vi.fn();
    render(
      <StageTabBar
        stages={stages}
        stageStatuses={allPendingStatuses()}
        selectedIndex={2}
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getAllByRole('tab')[0]);
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});

describe('StageTabBar — status icons', () => {
  it('shows "check" icon for completed stage', () => {
    render(
      <StageTabBar
        stages={['developer-agent']}
        stageStatuses={[makeStatus(0, 'completed')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('check')).toBeInTheDocument();
  });

  it('shows "progress_activity" icon for running stage', () => {
    render(
      <StageTabBar
        stages={['developer-agent']}
        stageStatuses={[makeStatus(0, 'running')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('progress_activity')).toBeInTheDocument();
  });

  it('shows "close" icon for failed stage', () => {
    render(
      <StageTabBar
        stages={['developer-agent']}
        stageStatuses={[makeStatus(0, 'failed')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('close')).toBeInTheDocument();
  });

  it('shows "timer_off" icon for timeout stage', () => {
    render(
      <StageTabBar
        stages={['developer-agent']}
        stageStatuses={[makeStatus(0, 'timeout')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('timer_off')).toBeInTheDocument();
  });

  it('shows "hourglass_empty" icon for pending stage', () => {
    render(
      <StageTabBar
        stages={['developer-agent']}
        stageStatuses={[makeStatus(0, 'pending')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('hourglass_empty')).toBeInTheDocument();
  });

  it('shows "pause_circle" icon for interrupted stage', () => {
    render(
      <StageTabBar
        stages={['developer-agent']}
        stageStatuses={[makeStatus(0, 'interrupted')]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('pause_circle')).toBeInTheDocument();
  });
});
